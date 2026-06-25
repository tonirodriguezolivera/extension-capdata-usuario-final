// background.js (Service Worker para Manifest V3)

const API_BASE_URL = 'https://capdata.es';
// const API_BASE_URL = 'https://toni-testdev.capdata.es';
// const API_BASE_URL = 'http://127.0.0.1:5000';

// Los endpoints de campos personalizados deben usar la misma base
// para evitar desalineaciones entre captura/mapeos y custom fields.
const CUSTOM_FIELDS_API_BASE_URL = API_BASE_URL;

// Tabla aeropuerto → IATA (cargada desde airports-iata.json)
let _airportsIataCache = null;
async function getAirportsIataMap() {
    if (_airportsIataCache) return _airportsIataCache;
    try {
        const url = chrome.runtime.getURL('airports-iata.json');
        const res = await fetch(url);
        _airportsIataCache = await res.json();
    } catch (e) {
        console.warn('BACKGROUND: No se pudo cargar airports-iata.json:', e);
        _airportsIataCache = {};
    }
    return _airportsIataCache;
}
// Tabla código IATA → nombre de aerolínea (invertida desde airlines-iata.json, que es nombre → código).
let _airlinesNameByCodeCache = null;
async function getAirlinesNameByCodeMap() {
    if (_airlinesNameByCodeCache) return _airlinesNameByCodeCache;
    const byCode = {};
    try {
        const url = chrome.runtime.getURL('airlines-iata.json');
        const res = await fetch(url);
        const nameToCode = await res.json();
        const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
        for (const [name, code] of Object.entries(nameToCode || {})) {
            const c = String(code || '').toUpperCase().trim();
            if (!c) continue;
            // Conservar el primer nombre visto por código (suele ser la variante más legible).
            if (!byCode[c]) byCode[c] = titleCase(name);
        }
    } catch (e) {
        console.warn('BACKGROUND: No se pudo cargar airlines-iata.json:', e);
    }
    _airlinesNameByCodeCache = byCode;
    return _airlinesNameByCodeCache;
}
function normalizeAirportForLookup(str) {
    if (!str || typeof str !== 'string') return '';
    return str.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}
function lookupAirportToIata(name, map) {
    if (!name || !map) return name;
    const v = String(name).trim();
    if (/^[A-Z]{3}$/i.test(v)) return v.toUpperCase(); // Ya es IATA
    const key = normalizeAirportForLookup(v);
    return map[key] || name;
}
// const API_BASE_URL = 'https://testdev.capdata.es';
// const API_BASE_URL = 'https://toni-testdev.capdata.es';
// const API_BASE_URL = 'http://127.0.0.1:5000';

// NUEVA FUNCIÓN: Extraer datos usando solo mapeos guardados (sin IA)
async function extractDataUsingMappings(tabId, mappingsNormal, mappingsOneWay, domain, reservationType, apiKey, shouldLeaveIssueDateEmpty = false, customSchema = [], fieldRegex = {}) {
    try {
        // 1. Limpieza de dominio robusta (brand name): de 'www.tickets.vueling.com' extrae 'vueling'
        let host = domain.replace(/^www\./i, '');
        const isIpHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
        const isLocalHost = host.toLowerCase() === 'localhost';
        let p = host.split('.');
        // Detectar si termina en .co.uk, .com.es, etc (TLD de dos partes)
        let isDoubleTLD = p.length > 2 && p[p.length - 2].length <= 3 && p[p.length - 1].length <= 3;
        const brandName = isDoubleTLD ? p[p.length - 3] : p[p.length - 2];
        const cleanDomainName = (isIpHost || isLocalHost) ? host : (brandName || p[0]);

        // Tabla código IATA → nombre de aerolínea (para derivar el proveedor desde el nº de vuelo).
        const airlineNameByCode = await getAirlinesNameByCodeMap();

        // --- NIVELES 1 Y 2: Ejecución de selectores conocidos y salto estructural en el cliente ---
        const extractionResults = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (mappingsNormal, mappingsOneWay, cleanDomain, serviceType, shouldLeaveIssueDateEmpty, customSchema, fieldRegex, airlineNameByCode) => {
                
                // --- HELPER 1: Motor de búsqueda blindado (Soporta :contains y evita SyntaxError) ---
                const smartQuerySelector = (selector) => {
                    try {
                        if (!selector.includes(':contains(')) {
                            return document.querySelector(selector);
                        }
                        const match = selector.match(/(.*?):contains\(['"](.*?)['"]\)(.*)/);
                        if (!match) return document.querySelector(selector);

                        const [_, baseSelector, searchText, extra] = match;
                        const candidates = document.querySelectorAll(baseSelector.trim() || '*');
                        
                        for (const el of candidates) {
                            if (el.textContent.includes(searchText)) {
                                if (extra && extra.trim().length > 0) {
                                    return el.querySelector(extra.trim());
                                }
                                return el;
                            }
                        }
                        return null;
                    } catch (e) {
                        return null; 
                    }
                };

                // --- HELPER 2: Normalizador de Fechas → siempre YYYY-MM-DD ---
                const standardizeDate = (dateStr) => {
                    if (!dateStr) return '';
                    const monthsMap = {
                        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
                        'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
                        'ene': '01', 'abr': '04', 'ago': '08', 'dic': '12'
                    };
                    
                    let clean = dateStr.toLowerCase().replace(/\s*h\s*$/i, '').split(/\s{2,}|-|–|at/)[0].trim();
                    
                    // dd/mm/yyyy o dd-mm-yyyy o dd.mm.yyyy → YYYY-MM-DD
                    let m1 = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
                    if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;

                    // "25 febrero, 2026" o "25 feb 2026" → YYYY-MM-DD
                    let m2 = clean.match(/(\d{1,2})\s+([a-záéíóúñ]+)\s*,?\s*(\d{4})/);
                    if (m2) {
                        const monthPart = m2[2].replace(/[^a-z]/g, '').substring(0, 3);
                        const mm = monthsMap[monthPart] || '01';
                        return `${m2[3]}-${mm}-${m2[1].padStart(2, '0')}`;
                    }

                    // "jue 15 may" / "thu 15 may" / "15 may" (sin año) → YYYY-MM-DD (año actual)
                    let m3 = clean.match(/^(?:(?:[a-záéíóúñ]{3,10})\.?\s+)?(\d{1,2})\s+([a-záéíóúñ]+)$/);
                    if (m3) {
                        const monthPart = m3[2].replace(/[^a-z]/g, '').substring(0, 3);
                        const mm = monthsMap[monthPart];
                        if (mm) {
                            const yyyy = String(new Date().getFullYear());
                            return `${yyyy}-${mm}-${m3[1].padStart(2, '0')}`;
                        }
                    }
                    return dateStr;
                };
                // Suma de Impuestos y Tasas
                const parseMoney = (val) => {
                    if (!val || typeof val !== 'string') return 0;
                    let clean = val.replace(/[^0-9.,]/g, '');
                    if (clean.includes(',') && clean.includes('.')) {
                        if (clean.indexOf('.') < clean.indexOf(',')) clean = clean.replace(/\./g, '').replace(',', '.');
                        else clean = clean.replace(/,/g, '');
                    } else { clean = clean.replace(',', '.'); }
                    return parseFloat(clean) || 0;
                };
                const extractValueByMethod = (node, methodName) => {
                    if (!node) return '';
                    if (methodName === 'value') return node.value || '';
                    if (String(methodName || '').startsWith('data-')) {
                        const attrName = String(methodName).replace('data-', '');
                        return node.getAttribute(`data-${attrName}`) || '';
                    }
                    return node.textContent?.trim() || node.innerText?.trim() || '';
                };
                const getElementsForSumSelector = (selector) => {
                    if (!selector || typeof selector !== 'string') return [];
                    try {
                        if (!selector.includes(':contains(')) {
                            return Array.from(document.querySelectorAll(selector));
                        }
                        const match = selector.match(/(.*?):contains\(['"](.*?)['"]\)(.*)/);
                        if (!match) return [];

                        const [_, baseSelector, searchText, extra] = match;
                        const candidates = Array.from(document.querySelectorAll(baseSelector.trim() || '*'));
                        const out = [];

                        for (const el of candidates) {
                            if ((el.textContent || '').includes(searchText)) {
                                if (extra && extra.trim().length > 0) {
                                    const nested = el.querySelector(extra.trim());
                                    if (nested) out.push(nested);
                                } else {
                                    out.push(el);
                                }
                            }
                        }
                        return out;
                    } catch (_e) {
                        return [];
                    }
                };
                const parseFlexibleSumNumber = (rawValue) => {
                    if (rawValue === null || rawValue === undefined) return null;
                    const raw = String(rawValue).replace(/\u00a0/g, ' ').trim();
                    if (!raw) return null;

                    let clean = raw.replace(/[^0-9.,\s-]/g, '').replace(/\s+/g, ' ').trim();
                    if (!clean) return null;

                    const hasComma = clean.includes(',');
                    const hasDot = clean.includes('.');

                    // Caso típico "12 34" (euros y céntimos en hijos distintos) -> 12.34
                    if (!hasComma && !hasDot) {
                        const splitCents = clean.match(/^(-?\d[\d\s]*)\s+(\d{2})$/);
                        if (splitCents) {
                            const intPart = splitCents[1].replace(/\s+/g, '');
                            clean = `${intPart}.${splitCents[2]}`;
                        } else {
                            clean = clean.replace(/\s+/g, '');
                        }
                    } else {
                        clean = clean.replace(/\s+/g, '');
                        if (clean.includes(',') && clean.includes('.')) {
                            if (clean.indexOf('.') < clean.indexOf(',')) clean = clean.replace(/\./g, '').replace(',', '.');
                            else clean = clean.replace(/,/g, '');
                        } else {
                            clean = clean.replace(',', '.');
                        }
                    }

                    const parsed = parseFloat(clean);
                    if (!isNaN(parsed) && /\d/.test(clean)) return parsed;
                    return null;
                };
                const processSumSelectors = (selectors, method, fieldLabel, logPrefix) => {
                    let total = 0;
                    let numericCount = 0;
                    const collectedValues = [];
                    const textValues = [];

                    (Array.isArray(selectors) ? selectors : []).forEach((sel) => {
                        const nodes = getElementsForSumSelector(String(sel || '').trim());
                        if (!nodes.length) {
                            console.log(`[${logPrefix}][sum:item:missing] ${fieldLabel} | selector=${sel}`);
                            return;
                        }

                        nodes.forEach((node, idx) => {
                            const valText = extractValueByMethod(node, method);
                            if (valText === null || valText === undefined) return;
                            const trimmedVal = String(valText).trim();
                            if (!trimmedVal) return;
                            collectedValues.push(trimmedVal);

                            const n = parseFlexibleSumNumber(trimmedVal);
                            if (n !== null) {
                                total += n;
                                numericCount += 1;
                                console.log(`[${logPrefix}][sum:item:number] ${fieldLabel} | selector=${sel}${nodes.length > 1 ? `[#${idx}]` : ''} | raw="${trimmedVal}" | parsed=${n}`);
                            } else {
                                textValues.push(trimmedVal);
                                console.log(`[${logPrefix}][sum:item:text] ${fieldLabel} | selector=${sel}${nodes.length > 1 ? `[#${idx}]` : ''} | raw="${trimmedVal}"`);
                            }
                        });
                    });

                    return { total, numericCount, collectedValues, textValues };
                };

                const normalizeDomainKey = (domain) => String(domain || '').trim().toLowerCase().replace(/^www\./i, '');
                const resolveDomainConfig = (domainsMap, cleanDomain) => {
                    if (!domainsMap || typeof domainsMap !== 'object') {
                        return { matchedConfig: null, matchedKey: null, candidates: [] };
                    }

                    const hostname = normalizeDomainKey(window.location.hostname || '');
                    const hostParts = hostname.split('.').filter(Boolean);
                    const rootDomain = hostParts.length >= 2 ? hostParts.slice(-2).join('.') : hostname;
                    const brandCandidate = normalizeDomainKey(cleanDomain);

                    const candidateSet = new Set([brandCandidate, hostname, rootDomain].filter(Boolean));
                    const candidates = [...candidateSet];

                    const normalizedDomainEntries = Object.entries(domainsMap).map(([rawKey, cfg]) => ({
                        rawKey,
                        normalizedKey: normalizeDomainKey(rawKey),
                        cfg
                    }));

                    for (const candidate of candidates) {
                        const exact = normalizedDomainEntries.find(entry => entry.normalizedKey === candidate);
                        if (exact) return { matchedConfig: exact.cfg, matchedKey: exact.rawKey, candidates };
                    }

                    for (const candidate of candidates) {
                        const partial = normalizedDomainEntries.find(entry =>
                            candidate.endsWith(`.${entry.normalizedKey}`) || entry.normalizedKey.endsWith(`.${candidate}`)
                        );
                        if (partial) return { matchedConfig: partial.cfg, matchedKey: partial.rawKey, candidates };
                    }

                    return { matchedConfig: null, matchedKey: null, candidates };
                };
                
                // --- FASE 1: DETECCIÓN DE DISEÑO (ANCLAS DE VUELTA) ---
                let hasConfirmedReturnSection = false;
                const returnAnchors = ['fecha_vuelta', 'num_vuelo_vuelta', 'hora_salida_vuelta', 'aeropuerto_salida_vuelta'];
                const isReturnFieldName = (name = '') => /(vuelta|retorno|return)/i.test(String(name));
                const hasNonEmptyValue = (value) => {
                    if (value === null || value === undefined) return false;
                    if (typeof value === 'string') return value.trim() !== '';
                    return true;
                };
                const readMappedPresenceValue = (el, extractionMethod) => {
                    if (!el) return '';
                    const method = extractionMethod || 'textContent';
                    if (method === 'value') {
                        return el.value || '';
                    }
                    if (String(method).startsWith('data-')) {
                        const attrName = String(method).replace('data-', '');
                        return el.getAttribute(`data-${attrName}`) || '';
                    }
                    if (method === 'selectedText' && el.tagName === 'SELECT') {
                        return el.selectedOptions?.[0]?.text || '';
                    }
                    return el.textContent?.trim() || el.innerText?.trim() || '';
                };
                // Divide un selector compuesto "A, B" en candidatos respetando
                // parentesis, corchetes y comillas para no romper :is(a,b),
                // [attr="a,b"] o :contains('a,b').
                const getSelectorCandidates = (rawSelector = '') => {
                    const selectorText = String(rawSelector || '').trim();
                    if (!selectorText) return [];
                    if (!selectorText.includes(',')) return [selectorText];
                    const parts = [];
                    let depthParen = 0;
                    let depthBracket = 0;
                    let inQuote = null;
                    let current = '';
                    for (let i = 0; i < selectorText.length; i++) {
                        const ch = selectorText[i];
                        const prev = i > 0 ? selectorText[i - 1] : '';
                        if (inQuote) {
                            if (ch === inQuote && prev !== '\\') inQuote = null;
                            current += ch;
                            continue;
                        }
                        if (ch === '"' || ch === "'") { inQuote = ch; current += ch; continue; }
                        if (ch === '(') depthParen++;
                        else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
                        else if (ch === '[') depthBracket++;
                        else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);
                        if (ch === ',' && depthParen === 0 && depthBracket === 0) {
                            const trimmed = current.trim();
                            if (trimmed) parts.push(trimmed);
                            current = '';
                            continue;
                        }
                        current += ch;
                    }
                    const tail = current.trim();
                    if (tail) parts.push(tail);
                    return parts.length > 0 ? parts : [selectorText];
                };
                // Fallback estricto por candidatos:
                //  1. Recorre los candidatos en el orden definido por el usuario.
                //  2. Devuelve el primero cuyo elemento exista Y tenga valor significativo.
                //  3. Si ninguno es significativo, devuelve el primer match (best-effort)
                //     para no perder por completo el campo.
                // Asi, "selectorA, selectorB" prueba A; si A no esta en el DOM o
                // su valor esta vacio/ruidoso, prueba B. Aplica a CUALQUIER campo.
                const resolveMappedElementWithFallback = (rawSelector, extractionMethod, fieldName = null) => {
                    const candidates = getSelectorCandidates(rawSelector);
                    let firstMatch = null;
                    const isMeaningfulRawValueForField = (fieldName, rawValue) => {
                        if (!hasNonEmptyValue(rawValue)) return false;
                        const valueText = String(rawValue).trim();
                        const codeLikeFields = ['localizador', 'codigo_reserva', 'num_vuelo_ida', 'num_vuelo_vuelta', 'Ida_Codigo', 'Vuelta_Codigo'];
                        if (!codeLikeFields.includes(fieldName)) return valueText !== '';
                        let cleaned = valueText;
                        if (cleaned.includes(':')) cleaned = cleaned.split(':').pop();
                        cleaned = cleaned
                            .replace(/(booking|code|reserva|vuelo|flight|ref|n[º#\.]|num\.?|no\.?|número)/gi, '')
                            .replace(/^[^a-z0-9]+/gi, '')
                            .trim();
                        return cleaned !== '';
                    };
                    for (const candidateSelector of candidates) {
                        const candidateEl = smartQuerySelector(candidateSelector);
                        if (!candidateEl) continue;
                        const candidateValue = readMappedPresenceValue(candidateEl, extractionMethod);
                        if (!firstMatch) {
                            firstMatch = { element: candidateEl, value: candidateValue };
                        }
                        if (isMeaningfulRawValueForField(fieldName, candidateValue)) {
                            return { element: candidateEl, value: candidateValue };
                        }
                    }
                    return firstMatch;
                };

                for (const anchor of returnAnchors) {
                    if (mappingsNormal[anchor]) {
                        const resolvedAnchor = resolveMappedElementWithFallback(
                            mappingsNormal[anchor].selector_path,
                            mappingsNormal[anchor].extraction_method
                        );
                        if (resolvedAnchor?.element && hasNonEmptyValue(resolvedAnchor.value)) {
                            hasConfirmedReturnSection = true;
                            break;
                        }
                    }
                }

                // Fallback defensivo: si hay selectores de vuelta visibles en DOM, no bloquear la vuelta.
                // Evita falsos "one-way" en páginas mapeadas donde el valor real no está en textContent.
                if (!hasConfirmedReturnSection) {
                    for (const [mappedFieldName, mappedConfig] of Object.entries(mappingsNormal || {})) {
                        if (!isReturnFieldName(mappedFieldName)) continue;
                        const mappedSelector = mappedConfig?.selector_path;
                        if (!mappedSelector) continue;

                        const resolvedReturn = resolveMappedElementWithFallback(mappedSelector, mappedConfig?.extraction_method);
                        const returnEl = resolvedReturn?.element;
                        if (!returnEl) continue;

                        const mappedValue = resolvedReturn?.value;
                        const isVisibleLike = returnEl.getClientRects().length > 0;
                        if (hasNonEmptyValue(mappedValue) || isVisibleLike) {
                            hasConfirmedReturnSection = true;
                            break;
                        }
                    }
                }

                // Elegimos el set de mapeos ganador.
                // Para OneWay hacemos merge con los mapeos normales para no perder campos genéricos
                // cuando el set one-way es parcial (solo sobrescribe lo específico one-way).
                const mergedOneWayMappings = { ...mappingsNormal, ...mappingsOneWay };
                const activeMappings = !hasConfirmedReturnSection ? mergedOneWayMappings : mappingsNormal;
                
                const results = {
                    extracted_fields: {},
                    failed_fields: {},
                    element_refs: {} 
                };

                const identityFields = {
                    'aereo': ['aerolinea_ida', 'aerolinea_vuelta'],
                    'hotel': ['nombre_hotel'],
                    'rent_a_car': ['empresa_alquiler'],
                    'tren': ['operador_tren']
                };

                // 1. PROCESAR CAMPOS DEL MAPEADO ELEGIDO
                // --- DENTRO DE extractDataUsingMappings -> func: (...) ---

                for (const [fieldName, mapping] of Object.entries(activeMappings)) {
                    try {
                        const selector = mapping.selector_path;
                        const method = mapping.extraction_method || 'textContent';

                        // ==========================================================
                        // 1. LÓGICA DE CAMPOS PERSONALIZADOS (DINÁMICOS)
                        // ==========================================================
                        if (mapping.is_custom) {
                            let config = mapping.field_config || {};
                            if (typeof config === 'string') {
                                try {
                                    config = JSON.parse(config);
                                } catch (cfgErr) {
                                    console.warn(`[CUSTOM_FIELD] field_config inválido para ${fieldName}:`, cfgErr, config);
                                    config = {};
                                }
                            }

                            const { matchedConfig: domainConfig, matchedKey: domainMatchKey, candidates: domainCandidates } = resolveDomainConfig(config.domains, cleanDomain);

                            console.log(`[CUSTOM_FIELD] ${fieldName} | type=${mapping.field_type || mapping.type || 'unknown'} | source=${config?.global?.source || 'n/a'} | cleanDomain=${cleanDomain} | candidates=${JSON.stringify(domainCandidates)} | matched=${domainMatchKey || 'none'}`);

                            // ==========================================================
                            // PRIORIDAD 1: VALOR FIJO POR DOMINIO (📍 TIPO: domain_static)
                            // ==========================================================
                            if (domainConfig && domainConfig.static_value !== undefined && domainConfig.static_value !== null && domainConfig.static_value !== "") {
                                results.extracted_fields[fieldName] = domainConfig.static_value;
                                console.log(`[CUSTOM_FIELD][domain_static] ${fieldName} =>`, {
                                    value: domainConfig.static_value,
                                    method: domainConfig.method || 'n/a',
                                    matched_domain: domainMatchKey || 'n/a'
                                });
                                continue;
                            }

                            // ==========================================================
                            // PRIORIDAD 2: EXTRACCIÓN DINÁMICA DE LA WEB
                            // ==========================================================

                            // Caso A: TIPO SUMA (Cálculo de múltiples elementos HTML - Ej: Tasas desglosadas)
                            const sumSource = String(config?.global?.source || '').toLowerCase();
                            const isSumByType = String(mapping.field_type || mapping.type || '').toLowerCase() === 'sum';
                            const sumSelectors = domainConfig?.selectors || config.global?.selectors;
                            const hasSumSelectors = Array.isArray(sumSelectors) && sumSelectors.length > 0;
                            const isMultiSelectorSum = sumSource === 'multi_selector_sum';
                            const shouldProcessAsSum = isSumByType || isMultiSelectorSum || hasSumSelectors;

                            if (shouldProcessAsSum) {
                                if (sumSelectors && Array.isArray(sumSelectors)) {
                                    const method = domainConfig?.method || config.global?.method || 'textContent';
                                    const sumResult = processSumSelectors(sumSelectors, method, fieldName, 'CUSTOM_FIELD');

                                    if (sumResult.collectedValues.length > 0) {
                                        if (sumResult.numericCount > 0) {
                                            results.extracted_fields[fieldName] = sumResult.total.toFixed(2);
                                            console.log(`[CUSTOM_FIELD][sum:number_total] ${fieldName} =>`, results.extracted_fields[fieldName], `(${sumResult.numericCount} items)`);
                                        } else {
                                            results.extracted_fields[fieldName] = sumResult.collectedValues;
                                            console.log(`[CUSTOM_FIELD][sum:text_array] ${fieldName} =>`, sumResult.collectedValues);
                                        }
                                        continue;
                                    }
                                }
                            }

                            // Caso B: TIPO SELECTOR (Mapeo de un solo elemento privado o global) y TIPO REGEX (selector + patrón)
                            const targetSelector = domainConfig?.selector || config.global?.selector;
                            if (targetSelector) {
                                const el = smartQuerySelector(targetSelector);
                                if (el) {
                                    const method = domainConfig?.method || config.global?.method || 'textContent';
                                    let rawVal = (method === 'value') ? (el.value || "") : (el.textContent?.trim() || "");
                                    const regexPattern = domainConfig?.regex || config.global?.regex;
                                    if (regexPattern && rawVal) {
                                        try {
                                            const re = new RegExp(regexPattern);
                                            const m = re.exec(String(rawVal));
                                            if (m) rawVal = (m[1] !== undefined ? m[1] : m[0]).trim();
                                        } catch (_) {}
                                    }
                                    results.extracted_fields[fieldName] = rawVal;
                                    console.log(`[CUSTOM_FIELD][selector] ${fieldName} (${targetSelector}) =>`, results.extracted_fields[fieldName]);
                                    continue;
                                }
                            }

                            // ==========================================================
                            // PRIORIDAD 3: CONFIGURACIÓN GLOBAL (FALLBACK - TIPO: text / enum)
                            // ==========================================================
                            if (config.global && config.global.static_value !== undefined && config.global.static_value !== null && config.global.static_value !== "") {
                                results.extracted_fields[fieldName] = config.global.static_value;
                                console.log(`[CUSTOM_FIELD][global_static] ${fieldName} =>`, config.global.static_value);
                                continue;
                            }

                            // Si es personalizado pero no tiene ninguna configuración válida, saltamos al siguiente campo
                            console.warn(`[CUSTOM_FIELD][no_value] ${fieldName} no encontró valor. Config:`, config);
                            continue; 
                        }

                        // ==========================================================
                        // 2. LÓGICA DE CAMPOS ESTÁNDAR (CAPDATA ORIGINAL)
                        // ==========================================================
                        const standardSumSelectors = Array.isArray(mapping.selectors)
                            ? mapping.selectors.map(s => String(s || '').trim()).filter(Boolean)
                            : [];
                        const isStandardSumMode = String(mapping.mapping_mode || '').toLowerCase() === 'sum' || standardSumSelectors.length > 0;

                        if (isStandardSumMode && standardSumSelectors.length > 0) {
                            const sumResult = processSumSelectors(standardSumSelectors, method, fieldName, 'STANDARD_FIELD');
                            if (sumResult.collectedValues.length > 0) {
                                results.extracted_fields[fieldName] = sumResult.numericCount > 0
                                    ? sumResult.total.toFixed(2)
                                    : sumResult.collectedValues;
                                console.log(`[STANDARD_FIELD][sum] ${fieldName} =>`, results.extracted_fields[fieldName], `(${sumResult.numericCount} num)`);
                                continue;
                            }
                        }

                        if (!selector) continue;

                        const isReturnField = fieldName.includes('vuelta') || fieldName.includes('retorno');
                        const hasReturnFieldEvidence = isReturnField
                            ? !!smartQuerySelector(selector)
                            : true;
                        
                        // Si no se confirmó al inicio pero el selector de vuelta existe, permitimos procesarlo.
                        if (isReturnField && !hasConfirmedReturnSection && !hasReturnFieldEvidence) continue;

                        // A. LÓGICA PASAJEROS MÚLTIPLES
                        if (fieldName === 'pasajeros') {
                            const genericSelector = selector.replace(/:nth-of-type\(\d+\)/g, '').replace(/:contains\(.*?\)/g, '');
                            const elements = document.querySelectorAll(genericSelector);
                            if (elements.length > 0) {
                                const ticketFieldName = activeMappings['num_billete']
                                    ? 'num_billete'
                                    : (activeMappings['numero_billete']
                                        ? 'numero_billete'
                                        : (activeMappings['codigo_billete'] ? 'codigo_billete' : null));
                                let ticketMethod = 'textContent';
                                let ticketSelectorRaw = '';
                                const extractValueByMethod = (node, methodName) => {
                                    if (!node) return '';
                                    if (methodName === 'value') return node.value || '';
                                    if (String(methodName || '').startsWith('data-')) {
                                        const attrName = String(methodName).replace('data-', '');
                                        return node.getAttribute(`data-${attrName}`) || '';
                                    }
                                    return node.textContent?.trim() || node.innerText?.trim() || '';
                                };
                                const isNoiseTicketValue = (val) => {
                                    const normalized = String(val || '').trim().toLowerCase();
                                    if (!normalized) return true;
                                    return /^(asientos?|seat|seats?|ida|vuelta|-|--|n\/a|na)$/.test(normalized);
                                };
                                const sanitizeTicketValue = (val) => {
                                    let cleaned = String(val || '').trim();
                                    if (!cleaned) return '';
                                    cleaned = cleaned.replace(/^(?:ticket|billete|n[º°o]\s*billete|numero\s*billete|n[úu]mero\s*billete)\s*[:#-]?\s*/i, '').trim();
                                    return cleaned.replace(/\D+/g, '');
                                };
                                if (ticketFieldName) {
                                    const ticketMapping = activeMappings[ticketFieldName];
                                    const ticketSelector = ticketMapping?.selector_path || '';
                                    ticketMethod = ticketMapping?.extraction_method || 'textContent';
                                    if (ticketSelector) {
                                        ticketSelectorRaw = ticketSelector;
                                    }
                                }
                                let globalTicketValues = [];
                                if (ticketSelectorRaw) {
                                    const normalizedSelector = ticketSelectorRaw.replace(/:contains\(.*?\)/g, '').trim();
                                    if (normalizedSelector) {
                                        try {
                                            globalTicketValues = Array.from(document.querySelectorAll(normalizedSelector))
                                                .map((node) => sanitizeTicketValue(extractValueByMethod(node, ticketMethod)));
                                        } catch (_e) {
                                            globalTicketValues = [];
                                        }
                                    }
                                }

                                const passengerNoiseRegex = /\s*(?:Nº|Número|Iberia Plus|Frequent Flyer|Loyalty|Socio|Asiento|Seat|Avios).*/i;
                                const normalizePassengerName = (rawValue) => {
                                    let normalized = String(rawValue || '').replace(/\s+/g, ' ').trim();
                                    normalized = normalized.replace(passengerNoiseRegex, '').trim();
                                    return normalized.replace(/\s+/g, ' ').trim();
                                };
                                const validPassengerEntries = Array.from(elements)
                                    .map((el) => ({
                                        element: el,
                                        nameText: normalizePassengerName(el.textContent || el.innerText || '')
                                    }))
                                    .filter((entry) => entry.nameText.length > 0);

                                results.extracted_fields[fieldName] = validPassengerEntries.map((entry, passengerIndex) => {
                                    const el = entry.element;
                                    const nameText = entry.nameText;
                                    let ticketValue = '';
                                    const passengerScope = el.closest('tbody') || el.closest('tr, .table-passengerDetail, .contentSection') || el.parentElement;
                                    if (passengerScope && ticketSelectorRaw) {
                                        const normalizedSelector = ticketSelectorRaw.replace(/:contains\(.*?\)/g, '').trim();
                                        const selectorCandidates = [];
                                        if (normalizedSelector) selectorCandidates.push(normalizedSelector);
                                        const tbodyTailMatch = normalizedSelector.match(/.*tbody(?:[^ >+~]*)\s*(?:[>+~]\s*)?(.*)$/i);
                                        if (tbodyTailMatch && tbodyTailMatch[1]) selectorCandidates.push(tbodyTailMatch[1].trim());
                                        const uniqueCandidates = [...new Set(selectorCandidates)].map(s => s.replace(/^[>+~\s]+/, '').trim()).filter(Boolean);

                                        for (const scopedSelector of uniqueCandidates) {
                                            let scopedCandidates = [];
                                            try { scopedCandidates = Array.from(passengerScope.querySelectorAll(scopedSelector)); } catch (_e) { continue; }
                                            for (const candidate of scopedCandidates) {
                                                const candidateValue = extractValueByMethod(candidate, ticketMethod);
                                                if (!isNoiseTicketValue(candidateValue)) {
                                                    ticketValue = candidateValue;
                                                    break;
                                                }
                                            }
                                            if (!isNoiseTicketValue(ticketValue)) break;
                                        }
                                    }
                                    if (isNoiseTicketValue(ticketValue) && globalTicketValues[passengerIndex]) {
                                        ticketValue = globalTicketValues[passengerIndex];
                                    }
                                    ticketValue = sanitizeTicketValue(ticketValue);
                                    if (isNoiseTicketValue(ticketValue)) return { nombre_pax: nameText };
                                    return { nombre_pax: nameText, num_billete: ticketValue };
                                });
                                continue;
                            }
                        }

                        // B. BÚSQUEDA DEL ELEMENTO ESTÁNDAR
                        const resolvedElement = resolveMappedElementWithFallback(selector, method, fieldName);
                        let element = resolvedElement?.element || null;
                        let value = resolvedElement?.value || '';
                        if (element) results.element_refs[fieldName] = element;
                        // Aplicar regex de extracción si está definido para este campo
                        if (fieldRegex && fieldRegex[fieldName] && value && String(value).trim() !== '') {
                            try {
                                const re = new RegExp(fieldRegex[fieldName]);
                                const m = re.exec(String(value));
                                if (m) value = (m[1] !== undefined ? m[1] : m[0]).trim();
                            } catch (_) {}
                        }

                        // --- PROCESAMIENTO, LIMPIEZA Y VALIDACIÓN (NORMALIZADORES ORIGINALES) ---
                        if (value && value.trim() !== '') {
                            const fieldNameLc = String(fieldName || '').toLowerCase();
                            
                            if (fieldNameLc.includes('hora')) {
                                const separatorRegex = /\s*(?:-|–|—|→|->|\/)\s*/;
                                const parts = value.split(separatorRegex).map(p => p.trim()).filter(p => p.length > 0);
                                const times = [];
                                for (const part of parts) {
                                    const m = part.match(/\d{1,2}:\d{2}/);
                                    if (m) times.push(m[0]);
                                }
                                if (times.length === 0) { value = ''; } 
                                else {
                                    const isArrival =
                                        fieldNameLc.includes('llegada') ||
                                        fieldNameLc.includes('destino') ||
                                        fieldNameLc.includes('destination') ||
                                        fieldNameLc.includes('check_out');
                                    value = (isArrival && times.length >= 2) ? times[1] : times[0];
                                }
                                if (value) { results.extracted_fields[fieldName] = value; continue; }
                            }

                            if (fieldName === 'forma_pago') {
                                const valLower = value.toLowerCase();
                                const cardKeywords = ['visa', 'mastercard', 'amex', 'american express', 'tarjeta', 'card', 'maestro', 'diners'];
                                const hasCardPattern = /[x\*]{4,}/i.test(valLower) || /\d{4}/.test(valLower);
                                if (cardKeywords.some(kw => valLower.includes(kw)) || hasCardPattern) {
                                    value = 'Tarjeta de crédito';
                                } else if (valLower.includes('cash') || valLower.includes('efectivo') || valLower.includes('contado')) {
                                    value = 'Efectivo';
                                }
                            }

                            const isDateKey = fieldNameLc.includes('fecha') || fieldNameLc.includes('date');
                            if (isDateKey) {
                                value = standardizeDate(value);
                            }
                            else if (!fieldNameLc.includes('hora')) {
                                const isDateField = fieldNameLc.includes('booking') || fieldNameLc.includes('check_in') || fieldNameLc.includes('check_out');
                                if (!isDateField) {
                                    const separatorRegex = /\s+[-–—]\s+|\s*(?:→|->|\\|\|)\s*|\s+a\s+|\s*\/\s*|\s+\/\s+|(?<=[A-Z]{3})\s+(?=[A-Z]{3})/;
                                    const parts = value.split(separatorRegex).map(p => p.trim()).filter(p => p.length > 0);
                                    if (parts.length >= 2) {
                                        const isArrivalPart =
                                            fieldNameLc.includes('llegada') ||
                                            fieldNameLc.includes('destino') ||
                                            fieldNameLc.includes('destination') ||
                                            fieldNameLc.includes('check_out') ||
                                            fieldNameLc.includes('devolucion');
                                        value = isArrivalPart ? parts[parts.length - 1] : parts[0];
                                    }
                                }
                            }

                            if (fieldName.includes('aeropuerto')) {
                                const iataMatch = value.match(/\(?\b([a-zA-Z]{3})\b\)?/);
                                if (iataMatch) { value = iataMatch[1].toUpperCase(); }
                            }

                            if (fieldName === 'divisa') {
                                const valTrim = value.trim();
                                if (/^\d+([.,]\d+)?\s*$/.test(valTrim)) { value = ''; } 
                                else {
                                    const valLower = valTrim.toLowerCase();
                                    if (valLower.includes('€') || valLower === 'euro' || valLower === 'eur') value = 'EUR';
                                    else if (valLower.includes('$') || valLower.includes('dolar') || valLower.includes('dólar') || valLower === 'usd') value = 'USD';
                                    else if (valLower.includes('£') || valLower.includes('libra') || valLower === 'gbp') value = 'GBP';
                                    else {
                                        const codeMatch = valTrim.match(/\b([A-Z]{3})\b/i);
                                        if (codeMatch) value = codeMatch[1].toUpperCase();
                                    }
                                }
                            }

                            const fieldsToClean = ['localizador', 'codigo_reserva', 'num_vuelo_ida', 'num_vuelo_vuelta', 'Ida_Codigo', 'Vuelta_Codigo'];
                            if (fieldsToClean.includes(fieldName)) {
                                if (value.includes(':')) value = value.split(':').pop();
                                const labelRegex = /(booking|code|reserva|vuelo|flight|ref|n[º#\.]|num\.?|no\.?|número)/gi;
                                value = value.replace(labelRegex, '').replace(/^[^a-z0-9]+/gi, '').trim();
                            }

                            if (value && value.trim() !== '') {
                                results.extracted_fields[fieldName] = value;
                            } else {
                                throw new Error("Validation failed");
                            }

                        } else {
                            if (!isReturnField || hasConfirmedReturnSection || hasReturnFieldEvidence) {
                                const ancestorIdMatch = selector.match(/(#[a-zA-Z0-9_-]+)/);
                                results.failed_fields[fieldName] = {
                                    ancestor_id: ancestorIdMatch ? ancestorIdMatch[0] : null,
                                    original_selector: selector
                                };
                            }
                        }
                    } catch (loopError) {
                        const ancestorIdMatch = activeMappings[fieldName]?.selector_path?.match(/(#[a-zA-Z0-9_-]+)/);
                        results.failed_fields[fieldName] = {
                            ancestor_id: ancestorIdMatch ? ancestorIdMatch[0] : null,
                            original_selector: activeMappings[fieldName]?.selector_path
                        };
                    }
                }

                // 1.1 FALLBACK POST-LOOP PARA CUSTOM FIELDS
                // Si un campo personalizado no llegó en activeMappings o falló en el loop,
                // intentamos resolverlo desde customSchema para no perder valores estáticos/sum.
                if (Array.isArray(customSchema) && customSchema.length > 0) {
                    customSchema.forEach((cf) => {
                        try {
                            const slug = cf?.slug;
                            if (!slug) return;

                            const existing = results.extracted_fields[slug];
                            if (existing !== undefined && existing !== null && String(existing).trim() !== '') return;

                            let cfg = cf?.field_config || {};
                            if (typeof cfg === 'string') {
                                try {
                                    cfg = JSON.parse(cfg);
                                } catch (_e) {
                                    cfg = {};
                                }
                            }

                            const { matchedConfig: domainCfg, matchedKey: domainKey } = resolveDomainConfig(cfg?.domains, cleanDomain);

                            // A) domain_static / static por dominio
                            if (domainCfg && domainCfg.static_value !== undefined && domainCfg.static_value !== null && String(domainCfg.static_value).trim() !== '') {
                                results.extracted_fields[slug] = domainCfg.static_value;
                                console.log(`[CUSTOM_FIELD][post_static:domain] ${slug} =>`, {
                                    value: domainCfg.static_value,
                                    matched_domain: domainKey || 'n/a'
                                });
                                return;
                            }

                            // B) SUM por configuración (multi_selector_sum)
                            const cfgSource = String(cfg?.global?.source || '').toLowerCase();
                            const isSumCfg = cfgSource === 'multi_selector_sum';
                            const selectors = domainCfg?.selectors || cfg?.global?.selectors;
                            if (isSumCfg && Array.isArray(selectors) && selectors.length > 0) {
                                const method = domainCfg?.method || cfg?.global?.method || 'textContent';
                                const sumResult = processSumSelectors(selectors, method, slug, 'CUSTOM_FIELD');
                                if (sumResult.collectedValues.length > 0) {
                                    results.extracted_fields[slug] = sumResult.numericCount > 0
                                        ? sumResult.total.toFixed(2)
                                        : sumResult.collectedValues;
                                    console.log(`[CUSTOM_FIELD][post_sum] ${slug} =>`, results.extracted_fields[slug]);
                                    return;
                                }
                            }

                            // C) global static fallback
                            if (cfg?.global?.static_value !== undefined && cfg.global.static_value !== null && String(cfg.global.static_value).trim() !== '') {
                                results.extracted_fields[slug] = cfg.global.static_value;
                                console.log(`[CUSTOM_FIELD][post_static:global] ${slug} =>`, cfg.global.static_value);
                                return;
                            }

                            console.warn(`[CUSTOM_FIELD][post_missing] ${slug} sigue sin valor`, {
                                source: cfg?.global?.source,
                                hasDomains: !!cfg?.domains
                            });
                        } catch (postErr) {
                            console.warn('[CUSTOM_FIELD][post_fallback_error]', cf?.slug, postErr);
                        }
                    });
                }

                // 2. LÓGICA DE AUTO-INYECCIÓN (POST-BUCLE)
                const currentFields = results.extracted_fields;

                const fieldsToSum = ['imp_tasas', 'imp_fee_servicio', 'imp_fee_emision', 'tasa_gv', 'tasa_d'];
                let sumaDesglosada = 0;
                fieldsToSum.forEach(f => {
                    if (currentFields[f]) sumaDesglosada += parseMoney(currentFields[f]);
                });
                if (sumaDesglosada > 0) currentFields['imp_total_tasas'] = sumaDesglosada.toFixed(2);

                const now = new Date();
                const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

                if (!currentFields['fecha_booking'] || currentFields['fecha_booking'].trim() === '') currentFields['fecha_booking'] = todayDate;
                const issueDateValue = currentFields['fecha_emision'];
                const hasIssueDateValue = issueDateValue !== undefined && issueDateValue !== null && String(issueDateValue).trim() !== '';
                if (shouldLeaveIssueDateEmpty) {
                    // GIAV/Gesintur: no autocompletar fecha de emision, pero respetar el valor si viene mapeado.
                    if (!hasIssueDateValue) currentFields['fecha_emision'] = '';
                } else if (!hasIssueDateValue) {
                    currentFields['fecha_emision'] = todayDate;
                }
                
                // El estado booking siempre debe ser "Confirmed"
                currentFields['estado_booking'] = 'Confirmed';

                // --- NIVEL 2: derivar aerolínea desde el prefijo del nº de vuelo ---
                // El código IATA es el designador de 2 caracteres al inicio del nº de vuelo:
                // 2 letras (BA, FR, VY), letra+dígito (U2, W6, I2) o dígito+letra. Se convierte
                // a nombre con airlineNameByCode; si el código no está en la tabla, se usa el código.
                const airlineCodeFromFlight = (flightNum) => {
                    if (!flightNum) return '';
                    const s = String(flightNum).trim().toUpperCase().replace(/\s+/g, '');
                    const m = s.match(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])(?=\d)/);
                    return m ? m[1] : '';
                };
                const airlineNameFromFlightFields = (...flightFields) => {
                    for (const f of flightFields) {
                        const code = airlineCodeFromFlight(currentFields[f]);
                        if (code) return (airlineNameByCode && airlineNameByCode[code]) ? airlineNameByCode[code] : code;
                    }
                    return '';
                };
                const idaAirlineName = airlineNameFromFlightFields('num_vuelo_ida', 'Ida_Codigo');
                const vueltaAirlineName = airlineNameFromFlightFields('num_vuelo_vuelta', 'Vuelta_Codigo');
                // Portales agregadores donde el dominio NO es la aerolínea (p. ej. IAG): ahí
                // también derivamos aerolinea_ida/aerolinea_vuelta del nº de vuelo.
                const hostnameLower = (window.location.hostname || '').toLowerCase();
                const aggregatorBrands = ['iag'];
                const isAggregatorPortal = aggregatorBrands.includes(String(cleanDomain || '').toLowerCase()) || /(^|\.)iag\.cloud$/.test(hostnameLower);

                // Fallback proveedor: 1) mapeado  2) prefijo nº de vuelo de ida  3) dominio/subdominio.
                const hostnameWithoutWww = hostnameLower.replace(/^www\./i, '').trim();
                const providerFallback = cleanDomain || hostnameWithoutWww;
                if (!currentFields['proveedor_nombre'] || currentFields['proveedor_nombre'].trim() === '') {
                    currentFields['proveedor_nombre'] = idaAirlineName || providerFallback;
                }
                // El campo 'via' siempre debe llevar dominio/subdominio del portal capturado.
                currentFields['via'] = providerFallback;

                if (serviceType === 'aereo') {
                    const hasExtractedReturnValues = Object.entries(currentFields).some(([key, value]) => isReturnFieldName(key) && hasNonEmptyValue(value));
                    const hasReturnData = hasConfirmedReturnSection || hasExtractedReturnValues;
                    // Forma de pago: Por defecto "Cash" excepto si se detectó tarjeta de crédito
                    // Casos cubiertos:
                    // 1) No existe mapeo → campo no existe en currentFields → se pone "Cash"
                    // 2) Existe mapeo pero está vacío → campo no se agrega a extracted_fields → se pone "Cash"
                    // 3) Existe mapeo con valor → se normaliza (Tarjeta/Efectivo) → se mantiene el valor normalizado
                    if (!currentFields.hasOwnProperty('forma_pago') || !currentFields['forma_pago'] || String(currentFields['forma_pago']).trim() === '') {
                        currentFields['forma_pago'] = 'Cash';
                    }
                    if (!currentFields['aerolinea_ida'] || currentFields['aerolinea_ida'].trim() === '') {
                        // En agregadores (IAG) usar la aerolínea del nº de vuelo de ida; si no, el dominio.
                        currentFields['aerolinea_ida'] = (isAggregatorPortal && idaAirlineName) ? idaAirlineName : cleanDomain;
                    }
                    if (!currentFields['Ida_Compania'] || currentFields['Ida_Compania'].trim() === '') {
                        currentFields['Ida_Compania'] = cleanDomain;
                    }
                    if (hasReturnData) {
                        if (!currentFields['aerolinea_vuelta'] || currentFields['aerolinea_vuelta'].trim() === '') {
                            currentFields['aerolinea_vuelta'] = (isAggregatorPortal && vueltaAirlineName) ? vueltaAirlineName : cleanDomain;
                        }
                        if (!currentFields['Vuelta_Compania'] || currentFields['Vuelta_Compania'].trim() === '') {
                            currentFields['Vuelta_Compania'] = cleanDomain;
                        }
                    } else {
                        ['aerolinea_vuelta', 'Vuelta_Compania', 'num_pasajeros_vuelta', 'num_vuelo_vuelta', 'Vuelta_Codigo', 'fecha_vuelta', 'hora_salida_vuelta', 'hora_llegada_vuelta', 'aeropuerto_salida_vuelta', 'aeropuerto_llegada_vuelta', 'Vuelta_Origen_Fecha', 'Vuelta_Origen_Hora', 'Vuelta_Origen_Lugar', 'Vuelta_Destino_Fecha', 'Vuelta_Destino_Hora', 'Vuelta_Destino_Lugar'].forEach(f => delete currentFields[f]);
                    }
                } else if (serviceType === 'hotel' && (!currentFields['nombre_hotel'] || currentFields['nombre_hotel'].trim() === '')) {
                    currentFields['nombre_hotel'] = cleanDomain;
                }

                delete results.element_refs;

                return results;
            },
            args: [mappingsNormal, mappingsOneWay, cleanDomainName, reservationType, shouldLeaveIssueDateEmpty, customSchema, fieldRegex || {}, airlineNameByCode || {}]
        });

        const result = extractionResults[0]?.result;
        if (!result) throw new Error("La inyección de script no devolvió resultados.");

        // Modo estricto: solo usar selectores mapeados (sin rescate IA).
        const domainWithoutWww = (domain || '').replace(/^www\./i, '').trim();
        const providerFallback = cleanDomainName || domainWithoutWww;
        if (!result.extracted_fields['proveedor_nombre'] || String(result.extracted_fields['proveedor_nombre']).trim() === '') {
            result.extracted_fields['proveedor_nombre'] = providerFallback;
        }
        // Reforzar 'via' tras rescate IA para asegurar consistencia en el payload final.
        result.extracted_fields['via'] = providerFallback;

        // Aplicar tabla aeropuerto → IATA a campos de aeropuerto (nombre → código 3 letras)
        const airportsMap = await getAirportsIataMap();
        for (const [key, val] of Object.entries(result.extracted_fields)) {
            if (key.includes('aeropuerto') && val) {
                result.extracted_fields[key] = lookupAirportToIata(val, airportsMap);
            }
        }

        return {
            status: 'success',
            extracted_data: [{
                ...result.extracted_fields,
                reservation_type: result.extracted_fields.aerolinea_vuelta ? reservationType : `${reservationType}_oneway`
            }]
        };

    } catch (error) {
        console.error('BACKGROUND: Error crítico en extracción:', error);
        throw error;
    }
}

async function startFullCaptureProcess(apiKey, tabId, reservationType) {
    try {
        const MIN_REQUIRED_MAPPED_FIELDS = 1;
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = tab.url || '';
        const domain = tab.url ? new URL(tab.url).hostname : null;
        if (!domain) throw new Error("No se pudo determinar el dominio de la pestaña.");

        console.log(`[BACKGROUND] Iniciando captura en: ${domain}`);
        console.log(`[BACKGROUND] Tipo de reserva base: ${reservationType}`);

        // 1. OBTENER Y LIMPIAR EL HTML DE LA PÁGINA (Para posibles rescates IA)
        const injections = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const clone = document.documentElement.cloneNode(true);
                const tagsToRemove = [
                    'script', 'style', 'link', 'img', 'iframe', 'noscript', 'svg', 'canvas',
                    'header', 'footer', 'nav', 'aside', 'input', 'button',
                    'object', 'embed', 'base', 'meta'
                ];
                tagsToRemove.forEach(tag => {
                    clone.querySelectorAll(tag).forEach(el => el.remove());
                });
                let cleanedHTML = clone.outerHTML;
                cleanedHTML = cleanedHTML.replace(/\n\s*\n+/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
                return cleanedHTML;
            }
        });

        if (!injections || !injections[0].result) {
            throw new Error("No se pudo obtener el contenido de la página.");
        }

        // 2. VERIFICAR INTEGRACIONES Y REGLAS DE NEGOCIO
        const integrationResponse = await fetch(`${API_BASE_URL}/api/me/integrations`, { 
            headers: { "X-API-Key": apiKey } 
        });
        if (!integrationResponse.ok) throw new Error("No se pudo verificar la configuración del usuario.");
        
        const integrationData = await integrationResponse.json();
        const includeAvsis = integrationData.status === 'success' && integrationData.integrations.some(int => int.slug === 'avsis' && int.active);
        const includeGesintur = integrationData.status === 'success' && integrationData.integrations.some(int => int.slug === 'gesintur' && int.active);
        const includeOrbisweb = integrationData.status === 'success' && integrationData.integrations.some(int => (int.slug === 'orbisweb' || int.slug === 'orbis_web') && int.active);
        
        const baseReservationType = String(reservationType || '').split('_')[0];
        const isFlightFlow = reservationType === 'billetaje' || baseReservationType === 'aereo';
        const isGiavFlow = isFlightFlow && !includeAvsis && !includeGesintur && !includeOrbisweb;
        
        // Regla: No poner fecha de emisión automática si es GIAV o Gesintur
        const shouldLeaveIssueDateEmpty = isGiavFlow || includeGesintur;

        const buildWrongUrlCaptureError = (guidanceInfo, defaultMessage) => {
            if (!guidanceInfo?.has_url_scopes) return null;
            const guidance = guidanceInfo.guidance;
            const scopeList = Array.isArray(guidanceInfo.scopes) ? guidanceInfo.scopes.map(s => s.scope_value).filter(Boolean) : [];
            const text = (guidance?.instruction_text || '').trim();
            const message = text || `${defaultMessage}\nRealiza la captura desde:\n${scopeList.slice(0, 3).join('\n') || 'una URL mapeada en este dominio.'}`;
            const err = new Error(message);
            if (guidance?.instruction_image_url) {
                err.guidanceImageUrl = guidance.instruction_image_url;
            }
            return err;
        };

        const summarizeUrlScopeInfo = (apiData) => {
            const info = apiData?.url_scope_info || {};
            const hasUrlScopes = !!info.has_url_scopes;
            const scopes = Array.isArray(info.scopes) ? info.scopes : [];
            const guidance = info.guidance_for_current_or_fallback || apiData?.matched_scope_guidance || null;
            const isUrlMismatch = hasUrlScopes && String(apiData?.matched_scope || '').toLowerCase() !== 'url';
            return { has_url_scopes: hasUrlScopes, scopes, guidance, is_url_mismatch: isUrlMismatch };
        };
        const mergeUrlScopeInfos = (primary, secondary) => {
            const p = primary || {};
            const s = secondary || {};
            const combinedScopes = [...(Array.isArray(p.scopes) ? p.scopes : []), ...(Array.isArray(s.scopes) ? s.scopes : [])];
            const uniqueScopeValues = new Set();
            const dedupScopes = [];
            combinedScopes.forEach((item) => {
                const scopeValue = String(item?.scope_value || '').trim();
                if (!scopeValue || uniqueScopeValues.has(scopeValue)) return;
                uniqueScopeValues.add(scopeValue);
                dedupScopes.push(item);
            });
            return {
                has_url_scopes: !!(p.has_url_scopes || s.has_url_scopes || dedupScopes.length > 0),
                scopes: dedupScopes,
                guidance: p.guidance || s.guidance || null,
                is_url_mismatch: !!(p.is_url_mismatch || s.is_url_mismatch)
            };
        };
        const fetchDomainLevelGuidanceInfo = async (serviceTypes) => {
            const candidates = [...new Set((serviceTypes || []).map(s => String(s ?? '').trim()))];
            if (candidates.length === 0) return { has_url_scopes: false, scopes: [], guidance: null, is_url_mismatch: false };
            try {
                const responses = await Promise.all(candidates.map(async (serviceType) => {
                    try {
                        const url = new URL(`${API_BASE_URL}/api/field-selectors/url-guidance`);
                        url.searchParams.append('domain', domain);
                        url.searchParams.append('current_url', currentUrl);
                        url.searchParams.append('field_type', 'capture');
                        url.searchParams.append('service_type', serviceType);
                        const res = await fetch(url.toString(), { headers: { "X-API-Key": apiKey } });
                        const data = await res.json();
                        if (data?.status !== 'success') return null;
                        const info = data?.url_scope_info || {};
                        return {
                            has_url_scopes: !!info.has_url_scopes,
                            scopes: Array.isArray(info.scopes) ? info.scopes : [],
                            guidance: data?.guidance || info.guidance_for_current_or_fallback || null,
                            is_url_mismatch: false
                        };
                    } catch (_) {
                        return null;
                    }
                }));
                return responses.filter(Boolean).reduce((acc, curr) => mergeUrlScopeInfos(acc, curr), { has_url_scopes: false, scopes: [], guidance: null, is_url_mismatch: false });
            } catch (_) {
                return { has_url_scopes: false, scopes: [], guidance: null, is_url_mismatch: false };
            }
        };

        // 3. BÚSQUEDA DE MAPEADOS ESTÁNDAR (Normal y OneWay)
        let mappingsNormal = {};
        let mappingsOneWay = {};
        let customSchema = [];
        let urlScopeInfoNormal = { has_url_scopes: false, scopes: [], guidance: null, is_url_mismatch: false };
        let urlScopeInfoOneWay = { has_url_scopes: false, scopes: [], guidance: null, is_url_mismatch: false };

        try {
            const typeNormal = reservationType;
            const typeOneWay = `${reservationType}_oneway`;
            const [resNormal, resOneWay] = await Promise.all([
                fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&current_url=${encodeURIComponent(currentUrl)}&field_type=capture&service_type=${encodeURIComponent(typeNormal)}`, { 
                    headers: { "X-API-Key": apiKey }
                }),
                fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&current_url=${encodeURIComponent(currentUrl)}&field_type=capture&service_type=${encodeURIComponent(typeOneWay)}`, { 
                    headers: { "X-API-Key": apiKey }
                })
            ]);

            const dataN = await resNormal.json();
            const dataO = await resOneWay.json();

            if (dataN.status === 'success') {
                mappingsNormal = dataN.mappings || {};
                urlScopeInfoNormal = summarizeUrlScopeInfo(dataN);
            }
            if (dataO.status === 'success') {
                mappingsOneWay = dataO.mappings || {};
                urlScopeInfoOneWay = summarizeUrlScopeInfo(dataO);
            }

        } catch (error) {
            console.warn('[BACKGROUND] Error obteniendo mapeos estándar:', error);
        }

        // 4. VALIDACIÓN DE MAPEOS REALES DE LA URL (antes de fusionar campos fijos/custom)
        const isFixedLikeMapping = (mapping) => {
            if (!mapping || typeof mapping === 'string') return false;
            if (mapping.is_fixed === true || mapping.fixed === true) return true;
            if (mapping.is_custom !== true) return false;
            const cfg = (mapping.field_config && typeof mapping.field_config === 'object') ? mapping.field_config : {};
            const globalCfg = (cfg.global && typeof cfg.global === 'object') ? cfg.global : {};
            if (globalCfg.source === 'static' || globalCfg.source === 'static_value') return true;
            if (globalCfg.static_value !== undefined && globalCfg.static_value !== null && String(globalCfg.static_value).trim() !== '') return true;
            const domainsCfg = (cfg.domains && typeof cfg.domains === 'object') ? Object.values(cfg.domains) : [];
            return domainsCfg.some((d) => d && (
                d.source === 'static' ||
                d.source === 'static_value' ||
                (d.static_value !== undefined && d.static_value !== null && String(d.static_value).trim() !== '')
            ));
        };
        const extractEligibleMappings = (mappings) => Object.entries(mappings || {}).map(([fieldName, mapping]) => {
            if (!mapping) return null;
            if (isFixedLikeMapping(mapping)) return null;
            if (typeof mapping === 'string') {
                const selector = mapping.trim();
                if (!selector) return null;
                return { fieldName, selector };
            }
            if (typeof mapping.selector_path === 'string') {
                const selector = mapping.selector_path.trim();
                if (!selector) return null;
                return { fieldName, selector };
            }
            return null;
        }).filter(Boolean);
        const eligibleMappings = [...extractEligibleMappings(mappingsNormal), ...extractEligibleMappings(mappingsOneWay)];
        const mappedFieldNames = new Set(eligibleMappings.map((m) => m.fieldName));
        const combinedUrlScopeInfo = {
            has_url_scopes: !!(urlScopeInfoNormal.has_url_scopes || urlScopeInfoOneWay.has_url_scopes),
            scopes: [...(urlScopeInfoNormal.scopes || []), ...(urlScopeInfoOneWay.scopes || [])],
            guidance: urlScopeInfoNormal.guidance || urlScopeInfoOneWay.guidance || null,
            is_url_mismatch: !!(urlScopeInfoNormal.is_url_mismatch || urlScopeInfoOneWay.is_url_mismatch)
        };
        const baseReservationTypeForLookup = String(reservationType || '').split('_')[0];
        const domainLevelGuidanceInfo = await fetchDomainLevelGuidanceInfo([
            '',
            reservationType,
            `${reservationType}_oneway`,
            baseReservationTypeForLookup,
            `${baseReservationTypeForLookup}_oneway`,
            'aereo',
            'aereo_oneway',
            'billetaje',
            'hotel',
            'rent_a_car',
            'tren',
            'tren_oneway'
        ]);
        const effectiveUrlScopeInfo = mergeUrlScopeInfos(combinedUrlScopeInfo, domainLevelGuidanceInfo);
        if (effectiveUrlScopeInfo.is_url_mismatch) {
            const guidedError = buildWrongUrlCaptureError(
                effectiveUrlScopeInfo,
                'Web soportada para captura, pero estás en un lugar incorrecto.'
            );
            if (guidedError) throw guidedError;
        }
        if (mappedFieldNames.size < MIN_REQUIRED_MAPPED_FIELDS) {
            const guidedError = buildWrongUrlCaptureError(
                effectiveUrlScopeInfo,
                'Web soportada para captura, pero estás en un lugar incorrecto.'
            );
            if (guidedError) throw guidedError;
            throw new Error(`Esta URL no tiene suficientes campos mapeados (${mappedFieldNames.size}/${MIN_REQUIRED_MAPPED_FIELDS}). Mapea al menos ${MIN_REQUIRED_MAPPED_FIELDS} campos para capturar.`);
        }
        const selectorsToValidate = [...new Set(eligibleMappings.map((m) => m.selector))];
        const selectorPresenceCheck = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: (selectors) => {
                // Split robusto: respeta parentesis, corchetes y comillas para
                // que "selA, selB" pruebe cada candidato por separado.
                const splitCandidates = (raw) => {
                    const text = String(raw || '').trim();
                    if (!text) return [];
                    if (!text.includes(',')) return [text];
                    const parts = [];
                    let dp = 0, db = 0, q = null, cur = '';
                    for (let i = 0; i < text.length; i++) {
                        const c = text[i];
                        const p = i > 0 ? text[i - 1] : '';
                        if (q) {
                            if (c === q && p !== '\\') q = null;
                            cur += c; continue;
                        }
                        if (c === '"' || c === "'") { q = c; cur += c; continue; }
                        if (c === '(') dp++;
                        else if (c === ')') dp = Math.max(0, dp - 1);
                        else if (c === '[') db++;
                        else if (c === ']') db = Math.max(0, db - 1);
                        if (c === ',' && dp === 0 && db === 0) {
                            const t = cur.trim();
                            if (t) parts.push(t);
                            cur = '';
                            continue;
                        }
                        cur += c;
                    }
                    const tail = cur.trim();
                    if (tail) parts.push(tail);
                    return parts.length > 0 ? parts : [text];
                };
                for (const selector of selectors) {
                    const candidates = splitCandidates(selector);
                    for (const candidate of candidates) {
                        try {
                            if (document.querySelector(candidate)) return true;
                        } catch (_) {
                            // Ignorar selector candidato no valido y seguir probando.
                        }
                    }
                }
                return false;
            },
            args: [selectorsToValidate]
        });
        const hasAnyMappedSelectorInDom = !!selectorPresenceCheck?.[0]?.result;
        if (!hasAnyMappedSelectorInDom) {
            const guidedError = buildWrongUrlCaptureError(
                effectiveUrlScopeInfo,
                'Web soportada para captura, pero estás en un lugar incorrecto.'
            );
            if (guidedError) throw guidedError;
            throw new Error("La URL actual no tiene mapeos aplicables. Revisa el mapeo específico para esta URL.");
        }

        // 5. FUSIÓN CON CAMPOS PERSONALIZADOS PRIVADOS DEL USUARIO
        try {
            console.log(`[BACKGROUND] Descargando definiciones personalizadas para la fusión...`);
            const customDefRes = await fetch(`${API_BASE_URL}/api/get-fields-definition`, {
                headers: { "X-API-Key": apiKey }
            });
            const customDefData = await customDefRes.json();

            if (customDefData.status === 'success' && customDefData.custom_schema) {
                customSchema = customDefData.custom_schema || [];
                customDefData.custom_schema.forEach(cf => {
                    // Enriquecemos el campo con el flag is_custom para que el extractor lo reconozca
                    const enrichedField = {
                        ...cf,
                        is_custom: true
                    };
                    // Lo inyectamos en ambos diccionarios
                    mappingsNormal[cf.slug] = enrichedField;
                    mappingsOneWay[cf.slug] = enrichedField;
                });
                console.log(`[BACKGROUND] Se han fusionado ${customDefData.custom_schema.length} campos personalizados.`);
                console.log('[BACKGROUND] Custom slugs cargados:', customSchema.map(c => c.slug));
            }
        } catch (e) {
            console.error("[BACKGROUND] Error crítico fusionando campos personalizados:", e);
        }

        // 5b. OBTENER REGEX POR CAMPO (opcional)
        let fieldRegex = {};
        try {
            const regexUrl = new URL(`${API_BASE_URL}/api/field_regex`);
            regexUrl.searchParams.append('domain', domain);
            regexUrl.searchParams.append('current_url', currentUrl);
            regexUrl.searchParams.append('service_type', reservationType);
            const regexRes = await fetch(regexUrl.toString(), { headers: { 'X-API-Key': apiKey } });
            const regexData = await regexRes.json();
            if (regexData.status === 'ok' && regexData.field_regex && typeof regexData.field_regex === 'object') {
                fieldRegex = regexData.field_regex;
                console.log('[BACKGROUND] Regex por campo cargados:', Object.keys(fieldRegex).length);
            }
        } catch (e) {
            console.warn('[BACKGROUND] No se pudo cargar field_regex:', e);
        }
        
        // 6. EJECUTAR EXTRACCIÓN (Con los mapas ya unificados)
        console.log('[BACKGROUND] Ejecutando extracción multi-nivel...');
        const result = await extractDataUsingMappings(
            tabId, 
            mappingsNormal, 
            mappingsOneWay, 
            domain, 
            reservationType, 
            apiKey, 
            shouldLeaveIssueDateEmpty,
            customSchema,
            fieldRegex
        );
        
        if (!result || !Array.isArray(result.extracted_data)) {
            throw new Error(result?.message || "La extracción no devolvió datos válidos.");
        }

        // 7. PROCESAMIENTO FINAL Y DETECCIÓN DE TIPO DE VUELO
        const allReservationsData = result.extracted_data;
        const reservationsWithType = allReservationsData.map(reservation => {
            // Detectamos si es Ida y Vuelta mirando si existen datos de regreso
            const tieneVuelta = reservation.Vuelta_Compania || reservation.aerolinea_vuelta || reservation.Vuelta_Codigo || reservation.fecha_vuelta;
            
            return {
                ...reservation,
                reservation_type: tieneVuelta ? reservationType : `${reservationType}_oneway`,
                servicio: reservationType, 
                estado_booking: 'Confirmed'
            };
        });
        
        console.log(`[BACKGROUND] Captura finalizada. Reservas procesadas: ${reservationsWithType.length}`);

        // 8. GUARDAR EN STORAGE Y NOTIFICAR
        if (reservationsWithType.length > 0) {
            // Guardamos también el HTML ya limpio capturado en el paso 1 para que
            // viaje con el POST a /api/save_all_reservations y el backend pueda
            // persistirlo en RequestLog.raw_html. Sirve para depurar capturas
            // fallidas reportadas por usuarios. Truncado defensivo a 500 KB para
            // no superar el quota de chrome.storage.local.
            const capturedHtml = injections[0].result || '';
            const HTML_MAX_CHARS = 500_000;
            const htmlToStore = capturedHtml.length > HTML_MAX_CHARS
                ? capturedHtml.slice(0, HTML_MAX_CHARS) + `\n<!-- [TRUNCATED at ${HTML_MAX_CHARS} chars; original ${capturedHtml.length}] -->`
                : capturedHtml;
            await chrome.storage.local.set({
                savedReservationData: reservationsWithType,
                savedReservationPageHtml: htmlToStore,
            });
        }

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Captura Completada',
            message: `Se ha procesado la información con éxito. Abre la extensión para revisar los datos.`
        });

    } catch (error) {
        console.error("[BACKGROUND] Error en startFullCaptureProcess:", error);
        const hasGuidanceImage = !!(error && typeof error.guidanceImageUrl === 'string' && error.guidanceImageUrl.trim());
        chrome.notifications.create({
            type: hasGuidanceImage ? 'image' : 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Error de Captura',
            message: error.message || "Ocurrió un error inesperado.",
            imageUrl: hasGuidanceImage ? error.guidanceImageUrl.trim() : undefined
        });
    }
}


/* ──────────────────────────────────────────────────────────────────────────
 *  1) Al hacer clic en el icono de la extensión                              
 *  Inyecta en el frame principal y en iframes del mismo origen para que la UI
 *  sea visible también en webs hechas con iframes (ej. click4wheels).
 * ────────────────────────────────────────────────────────────────────────── */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    let frameIdsToUse = [0]; // Por defecto solo frame principal (comportamiento clásico)

    // Obtener todos los frames de la pestaña (requiere permiso webNavigation)
    if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
      try {
        const allFrames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        if (allFrames && allFrames.length > 0) {
          const tabOrigin = new URL(tab.url).origin;
          const sameOriginFrames = allFrames.filter((f) => {
            try {
              return f.url && (f.url.startsWith('http:') || f.url.startsWith('https:')) && new URL(f.url).origin === tabOrigin;
            } catch (_) {
              return false;
            }
          });
          if (sameOriginFrames.length > 0) {
            frameIdsToUse = sameOriginFrames.map((f) => f.frameId);
          }
        }
      } catch (_) {
        // Si getAllFrames falla, seguimos con solo frame principal
      }
    }

    // Inyectar content script en todos los frames del mismo origen (main + iframes)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: frameIdsToUse },
      files: ['contentScript.js']
    });
    console.log("BACKGROUND: Inyección de contentScript.js en frame(s):", frameIdsToUse);

    // Mostrar la UI SIEMPRE en el frame principal para evitar que aparezca recortada
    // en iframes pequeños (como barras inferiores o paneles embebidos).
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "toggleUI" }, { frameId: 0 });
    } catch (e) {
      // Si el frame principal no tiene listener, se ignora para no romper flujo.
    }
    console.log("BACKGROUND: Mensaje 'toggleUI' enviado a la pestaña", tab.id, "frame:", 0);

  } catch (error) {
    console.error(`BACKGROUND: Falló la inyección o el envío en la pestaña ${tab.id}:`, error);
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Operación no permitida',
        message: 'Esta extensión no puede ejecutarse en esta página especial de Chrome.'
    });
  }
});
/* ──────────────────────────────────────────────────────────────────────────
 *  2) Listener principal (popup  ↔  background)                              
 * ────────────────────────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCaptureProcess') {
        // Obtenemos el ID de la pestaña activa para inyectar el script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
                // Iniciamos el proceso en segundo plano. NO esperamos a que termine.
                startFullCaptureProcess(request.apiKey, tabs[0].id, request.reservationType);
                // Respondemos inmediatamente al popup para que sepa que la orden se recibió.
                sendResponse({ status: 'ok', message: 'Proceso iniciado en segundo plano.' });
            } else {
                sendResponse({ status: 'error', message: 'No se encontró una pestaña activa.' });
            }
        });
        return true;
    }

  /* ════════════════════════════════════════════════════════════════════════
   *  B) ACTUALIZAR RESERVA  →  /api/update_reservation (NUEVO)
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'updateReservation') {
    console.log("Acción 'updateReservation' recibida en background.js.");

    const { apiKey, flightData } = request;

    if (!apiKey || !flightData) {
      sendResponse({ status: 'error', message: "Faltan datos para actualizar." });
      return true;
    }

    // const serverUrl = "http://127.0.0.1:5000/api/update_reservation"; // TU URL LOCAL
    const serverUrl = `${API_BASE_URL}/api/update_reservation`; // URL de producción
    fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        flight_data: flightData
      })
    })
    .then(response => response.json())
    .then(data => {
      console.log("🛰️ Respuesta del servidor (/api/update_reservation):", data);
      sendResponse(data);
    })
    .catch(err => {
      console.error("❌ Error al llamar a /api/update_reservation:", err);
      sendResponse({ status: 'error', message: "Error de conexión al actualizar: " + err.toString() });
    });

    return true; // Respuesta asíncrona
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  C) COMPROBAR INTEGRACIÓN AVSIS  →  /api/me/integrations (NUEVO)
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'checkAvsisIntegration') {
    console.log("Acción 'checkAvsisIntegration' recibida.");
    const { apiKey } = request;

    if (!apiKey) {
      sendResponse({ status: 'error', message: "No se proporcionó API Key." });
      return true;
    }

    // const serverUrl = "http://127.0.0.1:5000/api/me/integrations"; // TU URL LOCAL
    const serverUrl = `${API_BASE_URL}/api/me/integrations`; // URL de producción
    fetch(serverUrl, {
      method: "GET",
      headers: { "X-API-Key": apiKey }
    })
    .then(response => response.json())
    .then(data => {
      console.log("🛰️ Respuesta de /api/me/integrations:", data);
      sendResponse(data);
    })
    .catch(err => {
      console.error("❌ Error al llamar a /api/me/integrations:", err);
      sendResponse({ status: 'error', message: "Error al verificar integraciones: " + err.toString() });
    });

    return true; // Respuesta asíncrona
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  G: COMPROBAR INTEGRACIÓN GESINTUR  →  /api/me/integrations (NUEVO)
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'checkGesinturIntegration') {
    console.log("Acción 'checkGesinturIntegration' recibida.");
    const { apiKey } = request;

    if (!apiKey) {
      sendResponse({ status: 'error', message: "No se proporcionó API Key." });
      return true;
    }

    // const serverUrl = "http://127.0.0.1:5000/api/me/integrations"; // TU URL LOCAL
    const serverUrl = `${API_BASE_URL}/api/me/integrations`; // URL de producción
    fetch(serverUrl, {
      method: "GET",
      headers: { "X-API-Key": apiKey }
    })
    .then(response => response.json())
    .then(data => {
      console.log("🛰️ Respuesta de /api/me/integrations (Gesintur):", data);
      sendResponse(data);
    })
    .catch(err => {
      console.error("❌ Error al llamar a /api/me/integrations (Gesintur):", err);
      sendResponse({ status: 'error', message: "Error al verificar integraciones: " + err.toString() });
    });

    return true; // Respuesta asíncrona
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  H: COMPROBAR INTEGRACIÓN ORBISWEB  →  /api/me/integrations (NUEVO)
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'checkOrbiswebIntegration') {
    console.log("Acción 'checkOrbiswebIntegration' recibida.");
    const { apiKey } = request;

    if (!apiKey) {
      sendResponse({ status: 'error', message: "No se proporcionó API Key." });
      return true;
    }

    // const serverUrl = "http://127.0.0.1:5000/api/me/integrations"; // TU URL LOCAL
    const serverUrl = `${API_BASE_URL}/api/me/integrations`; // URL de producción
    fetch(serverUrl, {
      method: "GET",
      headers: { "X-API-Key": apiKey }
    })
    .then(response => response.json())
    .then(data => {
      console.log("🛰️ Respuesta de /api/me/integrations (ORBISWEB):", data);
      sendResponse(data);
    })
    .catch(err => {
      console.error("❌ Error al llamar a /api/me/integrations (ORBISWEB):", err);
      sendResponse({ status: 'error', message: "Error al verificar integraciones: " + err.toString() });
    });

    return true; // Respuesta asíncrona
  }


  /* ════════════════════════════════════════════════════════════════════════
   *  C.2) EXPEDIENTES ORBISWEB  →  /api/me/orbis/expedientes
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'getOrbisExpedientes') {
    const { apiKey, q, page, perPage } = request;
    if (!apiKey) { sendResponse({ status: 'error', message: "No se proporcionó API Key." }); return true; }

    const url = new URL(`${API_BASE_URL}/api/me/orbis/expedientes`);
    if (q) url.searchParams.set('q', q);
    if (page) url.searchParams.set('page', page);
    if (perPage) url.searchParams.set('per_page', perPage);

    fetch(url.toString(), { method: 'GET', headers: { 'X-API-Key': apiKey } })
      .then(response => response.json())
      .then(data => sendResponse(data))
      .catch(err => {
        console.error("❌ Error al cargar expedientes ORBISWEB:", err);
        sendResponse({ status: 'error', message: "Error al cargar expedientes: " + err.toString() });
      });
    return true; // Respuesta asíncrona
  }

  else if (request.action === 'getOrbisExpedienteServicios') {
    const { apiKey, expedienteId, live } = request;
    if (!apiKey) { sendResponse({ status: 'error', message: "No se proporcionó API Key." }); return true; }
    if (!expedienteId) { sendResponse({ status: 'error', message: "Falta expedienteId." }); return true; }

    const url = new URL(`${API_BASE_URL}/api/me/orbis/expedientes/${encodeURIComponent(expedienteId)}/servicios`);
    if (live) url.searchParams.set('live', '1');

    fetch(url.toString(), { method: 'GET', headers: { 'X-API-Key': apiKey } })
      .then(response => response.json())
      .then(data => sendResponse(data))
      .catch(err => {
        console.error("❌ Error al cargar servicios del expediente ORBISWEB:", err);
        sendResponse({ status: 'error', message: "Error al cargar servicios: " + err.toString() });
      });
    return true; // Respuesta asíncrona
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  C.3) NIF DEL PASAJERO POR NOMBRE  →  /api/contacts/lookup-nif
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'lookupPassengerNif') {
    const { apiKey, name } = request;
    if (!apiKey || !name) { sendResponse({ status: 'success', nif: null, match: 'empty' }); return true; }

    const url = new URL(`${API_BASE_URL}/api/contacts/lookup-nif`);
    url.searchParams.set('name', name);

    fetch(url.toString(), { method: 'GET', headers: { 'X-API-Key': apiKey } })
      .then(response => response.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ status: 'error', message: "Error al buscar NIF: " + err.toString() }));
    return true; // Respuesta asíncrona
  }


  /* ════════════════════════════════════════════════════════════════════════
   *  D) ENVIAR A CLIENTIFY  →  /api/sendToClientify
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'sendToClientify') {
    console.log("Acción sendToClientify disparada...");

    const flightData     = request.flightData;
    const clientifyToken = request.clientifyToken;
    const capdataApiKey  = request.apiKey;

    if (!flightData)   { sendResponse({ ok: false, error: "No se ha proporcionado flightData para enviar a Clientify" }); return true; }
    if (!clientifyToken){ sendResponse({ ok: false, error: "No se ha proporcionado clientifyToken" }); return true; }
    if (!capdataApiKey){ sendResponse({ ok: false, error: "Falta la API Key de CapData para validar en el servidor" }); return true; }

    // const serverUrl = "https://capdata.es/api/sendToClientify";
    const serverUrl = `${API_BASE_URL}/api/sendToClientify`;

    fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: capdataApiKey,
        clientify_token: clientifyToken,
        flight_data: flightData
      })
    })
    .then(async (response) => {
      if (!response.ok) { throw new Error(`Status: ${response.status}`); }
      const data = await response.json();
      console.log("Respuesta de /api/sendToClientify:", data);

      if (data.error) { sendResponse({ ok: false, error: data.error }); }
      else            { sendResponse({ ok: true, data }); }
    })
    .catch(err => {
      console.error("Error al llamar a /api/sendToClientify:", err);
      sendResponse({ ok: false, error: err.toString() });
    });

    return true;   // respuesta asíncrona
  }

  /* ════════════════════════════════════════════════════════════════════════
   *  E: OBTENER DEFINICIÓN DE CAMPOS
   * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'getFieldsDefinition') {
        // Definimos una función asíncrona interna para poder usar await
        const executeGetFields = async () => {
            // Intentamos obtener la key del mensaje, y si no está, la buscamos en el storage local
            let apiKey = request.apiKey;
            
            if (!apiKey) {
                const result = await chrome.storage.local.get(['userApiKey']);
                apiKey = result.userApiKey || "";
            }

            console.log("BACKGROUND: Solicitando definiciones con API Key:", apiKey ? "Presente" : "AUSENTE");

            try {
                const response = await fetch(`${API_BASE_URL}/api/get-fields-definition`, {
                    method: 'GET',
                    headers: { 
                        "X-API-Key": apiKey, 
                        "Content-Type": "application/json"
                    }
                });
                const data = await response.json();
                console.log("BACKGROUND: Respuesta de /api/get-fields-definition:", data);
                sendResponse(data);
            } catch (error) {
                console.error("Error en el flujo de getFieldsDefinition:", error);
                sendResponse({ status: 'error', message: error.toString() });
            }
        };

        executeGetFields();
        return true; // Mantener canal abierto para respuesta asíncrona
    }

    /* ════════════════════════════════════════════════════════════════════════
   *  F: BÚSQUEDA DE CONTACTOS
   * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'searchContacts') {
        // 1. Extraemos folderId también
        const { apiKey, searchTerm, folderId } = request; 

        const fetchAllContacts = async () => {
            try {
                const initialUrl = new URL(`${API_BASE_URL}/api/contacts`);
                initialUrl.searchParams.append('per_page', 200);

                // 2. APLICAR FILTROS (Búsqueda y Carpeta)
                if (searchTerm) {
                    initialUrl.searchParams.append('search', searchTerm); // <--- NUEVO
                }
                if (folderId) {
                    initialUrl.searchParams.append('folder_id', folderId); // <--- NUEVO
                }

                // 3. Primera petición
                const initialResponse = await fetch(initialUrl.toString(), {
                    headers: { "X-API-Key": apiKey }
                });

                if (!initialResponse.ok) {
                    throw new Error(`Error del servidor: ${initialResponse.status}`);
                }

                const initialData = await initialResponse.json();
                if (initialData.status !== 'success') {
                    throw new Error(initialData.message || 'La API devolvió un error.');
                }

                let allContacts = initialData.contacts;
                const totalPages = initialData.pagination.pages;

                if (totalPages <= 1) {
                    return initialData;
                }

                // 4. Peticiones restantes (heredarán los params de search y folder_id automáticamente)
                const promises = [];
                for (let page = 2; page <= totalPages; page++) {
                    const pageUrl = new URL(initialUrl.toString()); // Copia la URL con los filtros ya puestos
                    pageUrl.searchParams.set('page', page); // Solo cambiamos la página
                    
                    promises.push(
                        fetch(pageUrl.toString(), { headers: { "X-API-Key": apiKey } })
                            .then(res => res.json())
                    );
                }

                const remainingPagesData = await Promise.all(promises);

                remainingPagesData.forEach(pageData => {
                    if (pageData.status === 'success' && pageData.contacts) {
                        allContacts = allContacts.concat(pageData.contacts);
                    }
                });
                
                return {
                    status: 'success',
                    contacts: allContacts,
                    pagination: { total: allContacts.length } 
                };

            } catch (error) {
                console.error("BACKGROUND: Error al obtener contactos:", error);
                return { status: 'error', message: error.message };
            }
        };

        fetchAllContacts().then(sendResponse);
        return true; 
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  G: OBTENER DETALLES COMPLETOS DE UN CONTACTO
     * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'getContactFullDetails') {
        const { apiKey, contactId, employeeToken } = request;

        const fetchContactFullDetails = async () => {
            try {
                const url = `${API_BASE_URL}/api/contacts/${contactId}/full`;
                const headers = {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                };
                
                if (employeeToken) {
                    headers['X-Employee-Token'] = employeeToken;
                }

                console.log("BACKGROUND: Llamando a:", url);
                const response = await fetch(url, {
                    method: 'GET',
                    headers: headers
                });

                console.log("BACKGROUND: Respuesta recibida:", response.status, response.statusText);

                if (!response.ok) {
                    let errorMessage = `Error ${response.status}: ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        if (errorData.message) {
                            errorMessage = errorData.message;
                        }
                    } catch (e) {
                        // Si no se puede parsear el JSON, usar el mensaje por defecto
                    }
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                
                if (data.status !== 'success') {
                    throw new Error(data.message || 'Error al obtener datos del contacto');
                }

                return data;

            } catch (error) {
                console.error("BACKGROUND: Error al obtener detalles del contacto:", error);
                return { status: 'error', message: error.message };
            }
        };

        fetchContactFullDetails().then(sendResponse);
        return true;
    }

    else if (request.action === 'getFolders') {
        const { apiKey, search } = request;

        const fetchFolders = async () => {
            try {
                // Ajusta la ruta '/api/folders' según tu configuración real de Flask
                const url = new URL(`${API_BASE_URL}/api/folders`);
                
                // Si hay término de búsqueda, lo enviamos para filtrar carpetas
                if (search) {
                    url.searchParams.append('search', search);
                }

                const response = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        "X-API-Key": apiKey,
                        "Content-Type": "application/json"
                    }
                });

                if (!response.ok) {
                    // Intentamos leer el error del backend si existe
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.message || `Error ${response.status} al obtener carpetas`);
                }

                const data = await response.json();
                return data; // Se espera { status: 'success', folders: [...] }

            } catch (error) {
                console.error("BACKGROUND: Error en getFolders:", error);
                return { status: 'error', message: error.message };
            }
        };

        fetchFolders().then(sendResponse);
        return true; // Necesario para respuesta asíncrona
    }
    /* ════════════════════════════════════════════════════════════════════════
     *  NUEVO: ANALIZAR FORMULARIO CON IA
     * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'analyzeForm') {
        const { apiKey, domain, html, force_analysis } = request;

        fetch(`${API_BASE_URL}/api/form-selectors`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey // Autenticación con tu API
            },
            body: JSON.stringify({
                domain: domain,
                html: html,
                force_analysis: force_analysis
            })
        })
        .then(response => response.json())
        .then(data => {
            // Simplemente reenviamos la respuesta de CapData al popup
            sendResponse(data); 
        })
        .catch(err => {
            sendResponse({ status: 'error', message: err.toString() });
        });

        return true; // Esencial para la respuesta asíncrona
    }

    else if (request.action === 'saveAllReservations') {
      console.log("Acción 'saveAllReservations' recibida. Enviando lote al backend.");

      const { apiKey, reservationsData, requestId } = request;

      if (!apiKey || !reservationsData) {
        sendResponse({ status: 'error', message: "Faltan datos (apiKey o reservationsData) para el guardado." });
        return true;
      }

      const serverUrl = `${API_BASE_URL}/api/save_all_reservations`;

      // Recuperamos el HTML capturado en startFullCaptureProcess (paso 1) que
      // guardamos en chrome.storage.local junto con savedReservationData. Si
      // por cualquier motivo no existe (captura manual, recuperación de sesión
      // antigua...), el backend simplemente recibirá null y no romperá nada.
      chrome.storage.local.get(['savedReservationPageHtml'], (storageRes) => {
        const pageHtml = (storageRes && typeof storageRes.savedReservationPageHtml === 'string')
          ? storageRes.savedReservationPageHtml
          : null;

        const payloadToSend = {
          api_key: apiKey,
          reservations_data: reservationsData,
          reservation_type: reservationsData[0]?.reservation_type || 'aereo',
          webhook_structure_mode: 'effective',
          webhook_structure_integration_slug: null,
          // request_id permite a la extensión hacer polling al endpoint
          // GET /api/save_all_reservations/progress/<id> para pintar el
          // checklist en vivo del backend. Si no se pasa, el backend funciona
          // igual pero sin reportar progreso (no-op).
          request_id: requestId || null,
          // HTML limpio capturado por la extensión; el backend lo guarda en
          // RequestLog.raw_html (saneado y truncado a 500 KB) para depuración.
          page_html: pageHtml
        };
        console.log('[BACKEND] Payload que se envía a POST /api/save_all_reservations:', payloadToSend);
        console.log('[BACKEND] JSON completo (reservations_data):', JSON.stringify(reservationsData, null, 2));

        fetch(serverUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadToSend)
        })
        .then(res => res.json())
        .then(data => {
            console.log("🛰️ Respuesta del servidor a /api/save_all_reservations:", data);
            // Limpiamos el HTML de storage tras un guardado correcto para no
            // dejar HTML de capturas antiguas asociado a la próxima reserva.
            if (data && data.status !== 'error') {
              chrome.storage.local.remove('savedReservationPageHtml');
            }
            sendResponse(data);
        })
        .catch(err => {
            console.error("❌ Error grave al llamar a /api/save_all_reservations:", err);
            sendResponse({ status: 'error', message: "Error de conexión en el guardado: " + err.toString() });
        });
      });

      return true; // Esencial para la respuesta asíncrona
    }

    else if (request.action === 'getSaveProgress') {
      // Polling ligero para que el popup pinte el checklist de progreso.
      // Devuelve el estado actual escrito por el backend mientras procesa el
      // POST /api/save_all_reservations. Diseñado para llamarse cada ~400 ms.
      const { apiKey, requestId } = request;
      if (!apiKey || !requestId) {
        sendResponse({ status: 'error', message: 'Falta apiKey o requestId.' });
        return true;
      }
      const url = `${API_BASE_URL}/api/save_all_reservations/progress/${encodeURIComponent(requestId)}?api_key=${encodeURIComponent(apiKey)}`;
      fetch(url, { method: 'GET' })
        .then(res => res.json().then(j => ({ httpStatus: res.status, body: j })))
        .then(({ httpStatus, body }) => {
          if (httpStatus === 404) {
            sendResponse({ status: 'not_found' });
            return;
          }
          if (httpStatus === 403) {
            sendResponse({ status: 'forbidden' });
            return;
          }
          sendResponse(body || { status: 'error', message: 'Respuesta vacía' });
        })
        .catch(err => {
          // Errores de red en polling son no críticos: la siguiente tick los reintentará.
          sendResponse({ status: 'network_error', message: err.toString() });
        });
      return true;
    }

    else if (request.action === 'getIntegrationVisibility') {
      const { apiKey } = request;
      if (!apiKey) {
        sendResponse({ status: 'error', message: 'Falta API Key.' });
        return true;
      }
      fetch(`${API_BASE_URL}/api/integration_visibility`, { method: 'GET', headers: { 'X-API-Key': apiKey } })
        .then(res => res.ok ? res.json() : { status: 'ok', visibility: { avsis: true, gesintur: true, orbisweb: true } })
        .then(data => {
          const visibility = data.visibility || data.integration_visibility;
          if (visibility && typeof visibility === 'object') {
            sendResponse({ status: 'ok', visibility: { avsis: visibility.avsis !== false, gesintur: visibility.gesintur !== false, orbisweb: visibility.orbisweb !== false } });
          } else {
            sendResponse({ status: 'ok', visibility: { avsis: true, gesintur: true, orbisweb: true } });
          }
        })
        .catch(() => sendResponse({ status: 'ok', visibility: { avsis: true, gesintur: true, orbisweb: true } }));
      return true;
    }

    else if (request.action === 'getIntegrationFieldVisibility') {
      const { apiKey } = request;
      if (!apiKey) {
        sendResponse({ status: 'error', message: 'Falta API Key.' });
        return true;
      }
      fetch(`${API_BASE_URL}/api/integration_field_visibility`, { method: 'GET', headers: { 'X-API-Key': apiKey } })
        .then(res => res.ok ? res.json() : {})
        .then(data => sendResponse(data))
        .catch(() => sendResponse({ status: 'error', message: 'Error de conexión' }));
      return true;
    }

    else if (request.action === 'getStandardFieldVisibility') {
      const { apiKey } = request;
      if (!apiKey) {
        sendResponse({ status: 'error', message: 'Falta API Key.' });
        return true;
      }
      fetch(`${API_BASE_URL}/api/standard_field_visibility`, { method: 'GET', headers: { 'X-API-Key': apiKey } })
        .then(res => res.ok ? res.json() : {})
        .then(data => sendResponse(data))
        .catch(() => sendResponse({ status: 'error', message: 'Error de conexión' }));
      return true;
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  CAPTURE - Field selectors / regex / custom fields (READ-ONLY)
     * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'getFieldSelectors') {
        const { apiKey, domain, fieldType, serviceType, scopeType, scopeValue, currentUrl, strictScope } = request;
        
        if (!apiKey || !domain || !fieldType) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        const url = new URL(`${API_BASE_URL}/api/field-selectors`);
        url.searchParams.append('domain', domain);
        if (scopeType) url.searchParams.append('scope_type', scopeType);
        if (scopeValue) url.searchParams.append('scope_value', scopeValue);
        if (currentUrl) url.searchParams.append('current_url', currentUrl);
        if (strictScope) url.searchParams.append('strict_scope', '1');
        url.searchParams.append('field_type', fieldType);
        url.searchParams.append('service_type', serviceType || 'aereo');
        
        fetch(url.toString(), {
            method: 'GET',
            headers: {
                'X-API-Key': apiKey
            }
        })
        .then(response => response.json())
        .then(data => {
            sendResponse(data);
        })
        .catch(err => {
            console.error('Error getting field selectors:', err);
            sendResponse({ status: 'error', message: err.toString() });
        });
        
        return true;
    }

    else if (request.action === 'getFieldRegex') {
        const { apiKey, domain, serviceType, currentUrl } = request;
        if (!apiKey || !domain) {
            sendResponse({ status: 'error', message: 'Faltan apiKey o domain.' });
            return true;
        }
        const url = new URL(`${API_BASE_URL}/api/field_regex`);
        url.searchParams.append('domain', domain);
        if (currentUrl) url.searchParams.append('current_url', currentUrl);
        url.searchParams.append('service_type', serviceType || 'aereo');
        fetch(url.toString(), { method: 'GET', headers: { 'X-API-Key': apiKey } })
            .then(res => res.json())
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ status: 'error', message: err.toString() }));
        return true;
    }

    else if (request.action === 'getCustomFields') {
        const { apiKey, platformSlug } = request;
        fetch(`${CUSTOM_FIELDS_API_BASE_URL}/api/custom-fields?platform_slug=${platformSlug}`, {
            headers: { "X-API-Key": apiKey }
        })
        .then(res => res.json())
        .then(data => sendResponse(data))
        .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

});
