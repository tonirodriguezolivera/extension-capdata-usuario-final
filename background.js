// background.js (Service Worker para Manifest V3)

const API_BASE_URL = 'https://capdata.es';
// const API_BASE_URL = 'https://testdev.capdata.es';
// const API_BASE_URL = 'https://toni-testdev.capdata.es';
// const API_BASE_URL = 'http://127.0.0.1:5000';

// NUEVA FUNCIÓN: Extraer datos usando solo mapeos guardados (sin IA)
async function extractDataUsingMappings(tabId, mappingsNormal, mappingsOneWay, domain, reservationType, apiKey) {
    try {
        // 1. Limpieza de dominio robusta (brand name): de 'www.tickets.vueling.com' extrae 'vueling'
        let host = domain.replace(/^www\./i, '');
        let p = host.split('.');
        // Detectar si termina en .co.uk, .com.es, etc (TLD de dos partes)
        let isDoubleTLD = p.length > 2 && p[p.length - 2].length <= 3 && p[p.length - 1].length <= 3;
        const brandName = isDoubleTLD ? p[p.length - 3] : p[p.length - 2];
        const cleanDomainName = brandName || p[0];

        // --- NIVELES 1 Y 2: Ejecución de selectores conocidos y salto estructural en el cliente ---
        const extractionResults = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: (mappingsNormal, mappingsOneWay, cleanDomain, serviceType) => {
                
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

                // --- HELPER 2: Normalizador de Fechas (dd/mm/aaaa) ---
                const standardizeDate = (dateStr) => {
                    if (!dateStr) return '';
                    const monthsMap = {
                        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
                        'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
                        'ene': '01', 'abr': '04', 'ago': '08', 'dic': '12'
                    };
                    
                    let clean = dateStr.toLowerCase().replace(/\s*h\s*$/i, '').split(/\s{2,}|-|–|at/)[0].trim();
                    
                    let m1 = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
                    if (m1) return `${m1[1].padStart(2, '0')}/${m1[2].padStart(2, '0')}/${m1[3]}`;

                    let m2 = clean.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
                    if (m2) {
                        const monthPart = m2[2].substring(0, 3);
                        const mm = monthsMap[monthPart] || '01';
                        return `${m2[1].padStart(2, '0')}/${mm}/${m2[3]}`;
                    }
                    return dateStr;
                };

                // --- FASE 1: DETECCIÓN DE DISEÑO (ANCLAS DE VUELTA) ---
                let hasConfirmedReturnSection = false;
                const returnAnchors = ['fecha_vuelta', 'num_vuelo_vuelta', 'hora_salida_vuelta', 'aeropuerto_salida_vuelta'];
                
                for (const anchor of returnAnchors) {
                    if (mappingsNormal[anchor]) {
                        const el = smartQuerySelector(mappingsNormal[anchor].selector_path);
                        if (el && el.textContent.trim() !== '') {
                            hasConfirmedReturnSection = true;
                            break;
                        }
                    }
                }

                // Elegimos el set de mapeos ganador
                const activeMappings = (!hasConfirmedReturnSection && Object.keys(mappingsOneWay).length > 0) ? mappingsOneWay : mappingsNormal;
                
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
                for (const [fieldName, mapping] of Object.entries(activeMappings)) {
                    try {
                        const selector = mapping.selector_path;
                        const method = mapping.extraction_method || 'textContent';
                        if (!selector) continue;

                        const isReturnField = fieldName.includes('vuelta') || fieldName.includes('retorno');
                        
                        // Bloqueo estricto de campos de vuelta si no hay evidencia física
                        if (isReturnField && !hasConfirmedReturnSection) continue;

                        // A. LÓGICA PASAJEROS MÚLTIPLES
                        if (fieldName === 'pasajeros') {
                            const genericSelector = selector.replace(/:nth-of-type\(\d+\)/g, '').replace(/:contains\(.*?\)/g, '');
                            const elements = document.querySelectorAll(genericSelector);
                            if (elements.length > 0) {
                                results.extracted_fields[fieldName] = Array.from(elements).map(el => {
                                    let nameText = el.textContent?.trim() || el.innerText?.trim() || '';
                                    const passengerNoiseRegex = /\s*(?:Nº|Número|Iberia Plus|Frequent Flyer|Loyalty|Socio|Asiento|Seat|Avios).*/i;
                                    nameText = nameText.replace(passengerNoiseRegex, '').trim();
                                    
                                    // Limpiar espacios dobles que a veces deja el DOM
                                    nameText = nameText.replace(/\s+/g, ' ');

                                    return { nombre_pax: nameText };
                                });
                                continue;
                            }
                        }

                        // B. BÚSQUEDA DEL ELEMENTO
                        let element = smartQuerySelector(selector);
                        const allowLevel2 = !isReturnField || (isReturnField && hasConfirmedReturnSection);

                        if (!element && !selector.includes(':contains(') && allowLevel2) {
                            const idMatch = selector.match(/(#[a-zA-Z0-9_-]+)/);
                            const parts = selector.split(/[ >]+/);
                            const lastPart = parts[parts.length - 1];
                            if (idMatch && lastPart) {
                                const ancestorId = idMatch[0];
                                const simplifiedSelector = `${ancestorId} ${lastPart}`;
                                const fallbacks = document.querySelectorAll(simplifiedSelector);
                                for (const fb of fallbacks) {
                                    const counterpart = fieldName.replace('vuelta', 'ida');
                                    if (results.element_refs[counterpart] !== fb) {
                                        element = fb;
                                        break;
                                    }
                                }
                            }
                        }

                        let value = '';
                        if (element) {
                            results.element_refs[fieldName] = element;
                            if (method === 'value') {
                                value = element.value || '';
                            } else if (method.startsWith('data-')) {
                                const attrName = method.replace('data-', '');
                                value = element.getAttribute(`data-${attrName}`) || '';
                            } else {
                                value = element.textContent?.trim() || element.innerText?.trim() || '';
                            }
                        }

                        // --- PROCESAMIENTO, LIMPIEZA Y VALIDACIÓN ---
                        if (value && value.trim() !== '') {
                            
                            // 1. PRIORIDAD: HORA (Extraer HH:mm y evitar duplicados)
                            if (fieldName.includes('hora')) {
                                const timeMatches = value.match(/\d{1,2}:\d{2}/g);
                                if (!timeMatches) {
                                    value = ''; 
                                } else {
                                    const isArrival = fieldName.includes('llegada') || fieldName.includes('check_out');
                                    value = (isArrival && timeMatches.length >= 2) ? timeMatches[1] : timeMatches[0];
                                    results.extracted_fields[fieldName] = value;
                                    continue; 
                                }
                            }

                            // 2. NORMALIZACIÓN DE FORMA DE PAGO
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

                            // 3. NORMALIZACIÓN DE FECHAS
                            if (fieldName.includes('fecha')) {
                                value = standardizeDate(value);
                            } 
                            // 4. DIVISIÓN DE TRAYECTOS (Si no es fecha ni hora)
                            else if (!fieldName.includes('hora')) {
                                const isDateField = fieldName.includes('booking') || fieldName.includes('check_in') || fieldName.includes('check_out');
                                if (!isDateField) {
                                    const separatorRegex = /\s*(?:-|–|—|→|->|\\|\|)\s*|\s+\/\s+|(?<=[A-Z]{3})\s+(?=[A-Z]{3})/;
                                    const parts = value.split(separatorRegex).map(p => p.trim()).filter(p => p.length > 0);
                                    if (parts.length >= 2) {
                                        const isArrivalPart = fieldName.includes('llegada') || fieldName.includes('check_out') || fieldName.includes('devolucion');
                                        value = isArrivalPart ? parts[parts.length - 1] : parts[0];
                                    }
                                }
                            }

                            // 5. EXTRACCIÓN CÓDIGO IATA (Regex mejorada)
                            if (fieldName.includes('aeropuerto')) {
                                const iataMatch = value.match(/\(?\b([a-zA-Z]{3})\b\)?/);
                                if (iataMatch) {
                                    value = iataMatch[1].toUpperCase();
                                } else {
                                    value = ''; 
                                }
                            }

                            // 6. Limpieza de códigos (Reserva, Vuelo, etc.)
                            const fieldsToClean = ['localizador', 'codigo_reserva', 'num_vuelo_ida', 'num_vuelo_vuelta'];
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
                            // Protección Nivel 3 (IA)
                            if (!isReturnField || (isReturnField && hasConfirmedReturnSection)) {
                                const ancestorIdMatch = selector.match(/(#[a-zA-Z0-9_-]+)/);
                                results.failed_fields[fieldName] = {
                                    ancestor_id: ancestorIdMatch ? ancestorIdMatch[0] : null,
                                    original_selector: selector
                                };
                            }
                        }
                    } catch (loopError) {
                        const ancestorIdMatch = activeMappings[fieldName]?.selector_path.match(/(#[a-zA-Z0-9_-]+)/);
                        results.failed_fields[fieldName] = {
                            ancestor_id: ancestorIdMatch ? ancestorIdMatch[0] : null,
                            original_selector: activeMappings[fieldName]?.selector_path
                        };
                    }
                }

                // 2. LÓGICA DE AUTO-INYECCIÓN (POST-BUCLE)
                const currentFields = results.extracted_fields;

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

                const fieldsToSum = ['imp_tasas', 'imp_fee_servicio', 'imp_fee_emision', 'tasa_gv', 'tasa_d'];
                let sumaDesglosada = 0;
                fieldsToSum.forEach(f => {
                    if (currentFields[f]) sumaDesglosada += parseMoney(currentFields[f]);
                });
                if (sumaDesglosada > 0) currentFields['imp_total_tasas'] = sumaDesglosada.toFixed(2);

                const now = new Date();
                const todayDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

                if (!currentFields['fecha_booking'] || currentFields['fecha_booking'].trim() === '') currentFields['fecha_booking'] = todayDate;
                if (!currentFields['fecha_emision'] || currentFields['fecha_emision'].trim() === '') currentFields['fecha_emision'] = todayDate;
                
                // El estado booking siempre debe ser "Confirmed"
                currentFields['estado_booking'] = 'Confirmed';

                if (serviceType === 'aereo') {
                    // Forma de pago: Por defecto "Cash" excepto si se detectó tarjeta de crédito
                    // Casos cubiertos:
                    // 1) No existe mapeo → campo no existe en currentFields → se pone "Cash"
                    // 2) Existe mapeo pero está vacío → campo no se agrega a extracted_fields → se pone "Cash"
                    // 3) Existe mapeo con valor → se normaliza (Tarjeta/Efectivo) → se mantiene el valor normalizado
                    if (!currentFields.hasOwnProperty('forma_pago') || !currentFields['forma_pago'] || String(currentFields['forma_pago']).trim() === '') {
                        currentFields['forma_pago'] = 'Cash';
                    }
                    if (!currentFields['aerolinea_ida'] || currentFields['aerolinea_ida'].trim() === '') {
                        currentFields['aerolinea_ida'] = cleanDomain;
                    }
                    if (hasConfirmedReturnSection) {
                        if (!currentFields['aerolinea_vuelta'] || currentFields['aerolinea_vuelta'].trim() === '') {
                            currentFields['aerolinea_vuelta'] = cleanDomain;
                        }
                    } else {
                        ['aerolinea_vuelta', 'num_pasajeros_vuelta', 'num_vuelo_vuelta', 'fecha_vuelta', 'hora_salida_vuelta', 'hora_llegada_vuelta', 'aeropuerto_salida_vuelta', 'aeropuerto_llegada_vuelta'].forEach(f => delete currentFields[f]);
                    }
                } else if (serviceType === 'hotel' && (!currentFields['nombre_hotel'] || currentFields['nombre_hotel'].trim() === '')) {
                    currentFields['nombre_hotel'] = cleanDomain;
                }

                delete results.element_refs;

                return results;
            },
            args: [mappingsNormal, mappingsOneWay, cleanDomainName, reservationType]
        });

        const result = extractionResults[0]?.result;
        if (!result) throw new Error("La inyección de script no devolvió resultados.");

        // --- NIVEL 3: RESCATE CON IA ---
        const failedFieldsEntries = Object.entries(result.failed_fields);
        if (failedFieldsEntries.length > 0) {
            for (const [fieldName, info] of failedFieldsEntries) {
                if (info.ancestor_id) {
                    try {
                        const htmlSnippetResult = await chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            func: (id) => {
                                const container = document.querySelector(id);
                                return container ? container.outerHTML : null;
                            },
                            args: [info.ancestor_id]
                        });

                        const htmlSnippet = htmlSnippetResult[0]?.result;
                        if (htmlSnippet) {
                            const aiResponse = await fetch(`${API_BASE_URL}/api/find-specific-selectors`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                                body: JSON.stringify({ field_name: fieldName, domain: domain, field_type: 'capture', html: htmlSnippet })
                            });
                            
                            const aiData = await aiResponse.json();
                            if (aiData.status === 'success' && aiData.mapping && aiData.mapping.selector) {
                                const targetSelector = aiData.mapping.selector;
                                const finalExtraction = await chrome.scripting.executeScript({
                                    target: { tabId: tabId },
                                    func: (sel, fName, cleanDom, sType) => {
                                        const el = document.querySelector(sel);
                                        let val = el ? (el.textContent?.trim() || el.innerText?.trim() || '') : '';
                                        const isReturn = fName.includes('vuelta') || fName.includes('llegada');

                                        if (val.trim() !== '') {
                                            if (['localizador', 'codigo_reserva', 'num_vuelo_ida', 'num_vuelo_vuelta'].includes(fName)) {
                                                if (val.includes(':')) val = val.split(':').pop();
                                                val = val.replace(/(booking|code|reserva|vuelo|flight|ref|n[º#\.]|num\.?|no\.?|número)/gi, '').replace(/^[^a-z0-9]+/gi, '').trim();
                                            }
                                            if (fName.includes('aeropuerto')) {
                                                const m = val.match(/\(?\b([a-zA-Z]{3})\b\)?/);
                                                if (m) val = m[1].toUpperCase();
                                            }
                                        }

                                        const ids = { 'aereo': ['aerolinea_ida', 'aerolinea_vuelta'], 'hotel': ['nombre_hotel'], 'rent_a_car': ['empresa_alquiler'], 'tren': ['operador_tren'] };
                                        if ((ids[sType] || []).includes(fName)) return val || cleanDom;
                                        return val;
                                    },
                                    args: [targetSelector, fieldName, cleanDomainName, reservationType]
                                });

                                if (finalExtraction[0]?.result) {
                                    result.extracted_fields[fieldName] = finalExtraction[0].result;
                                }
                            }
                        }
                    } catch (aiErr) { console.error(`Error IA:`, aiErr); }
                }
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
        const tab = await chrome.tabs.get(tabId);
        const isVueling = tab.url.includes('vueling.com');
        console.log(`BACKGROUND: Comprobando si es Vueling: ${isVueling}`);
        console.log(`BACKGROUND: Tipo de reserva base: ${reservationType}`);

        // 1. OBTENER Y LIMPIAR EL HTML DE LA PÁGINA
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
            throw new Error("No se pudo obtener y limpiar el HTML de la página.");
        }
        
        const cleanedHtmlContent = injections[0].result;

        // 2. VERIFICAR INTEGRACIONES ACTIVAS
        const integrationResponse = await fetch(`${API_BASE_URL}/api/me/integrations`, { 
            headers: { "X-API-Key": apiKey } 
        });
        if (!integrationResponse.ok) throw new Error("No se pudo verificar la integración.");
        const integrationData = await integrationResponse.json();
        const includeAvsis = integrationData.status === 'success' && integrationData.integrations.some(int => int.slug === 'avsis' && int.active);
        console.log(`BACKGROUND: Comprobación de AVSIS: ${includeAvsis}`);

        // 3. EXTRAER DOMINIO DE LA PESTAÑA
        const domain = tab.url ? new URL(tab.url).hostname : null;
        if (!domain) throw new Error("No se pudo determinar el dominio de la pestaña.");
        
        // 4. BÚSQUEDA DUAL DE MAPEADOS (Normal y OneWay)
        let mappingsNormal = {};
        let mappingsOneWay = {};

        try {
            console.log(`BACKGROUND: Iniciando búsqueda dual de mapeos para ${domain}`);
            
            const typeNormal = reservationType;
            const typeOneWay = `${reservationType}_oneway`;

            // Pedimos ambos en paralelo para optimizar tiempo
            const [resNormal, resOneWay] = await Promise.all([
                fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&field_type=capture&service_type=${encodeURIComponent(typeNormal)}`, { 
                    headers: { "X-API-Key": apiKey }
                }),
                fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&field_type=capture&service_type=${encodeURIComponent(typeOneWay)}`, { 
                    headers: { "X-API-Key": apiKey }
                })
            ]);

            const dataNormal = await resNormal.json();
            const dataOneWay = await resOneWay.json();

            if (dataNormal.status === 'success' && dataNormal.mappings) {
                mappingsNormal = dataNormal.mappings;
            }
            if (dataOneWay.status === 'success' && dataOneWay.mappings) {
                mappingsOneWay = dataOneWay.mappings;
            }

            console.log(`BACKGROUND: Mapeos recuperados -> Normal: ${Object.keys(mappingsNormal).length}, OneWay: ${Object.keys(mappingsOneWay).length}`);

        } catch (error) {
            console.warn('BACKGROUND: Error obteniendo mapeos duales, intentando continuar:', error);
        }
        
        // 5. VALIDACIÓN DE EXISTENCIA DE MAPEOS
        if (Object.keys(mappingsNormal).length === 0 && Object.keys(mappingsOneWay).length === 0) {
            throw new Error("No hay campos mapeados para este dominio (ni normal ni oneway). Por favor, mapea los campos necesarios antes de capturar.");
        }
        
        // 6. EJECUTAR EXTRACCIÓN (Enviando ambos conjuntos para detección inteligente)
        let result;
        console.log('BACKGROUND: Ejecutando extracción con detección automática de diseño...');
        
        // Llamamos a la función de extracción pasando ambos mapeos
        result = await extractDataUsingMappings(tabId, mappingsNormal, mappingsOneWay, domain, reservationType, apiKey);
        
        console.log("BACKGROUND: Respuesta de extracción recibida:", result);

        if (!result || !Array.isArray(result.extracted_data)) {
            throw new Error(result?.message || "La extracción no devolvió un array de reservas válido.");
        }

        // 7. PROCESAMIENTO FINAL Y GUARDADO
        const allReservationsData = result.extracted_data;
        
        // Aseguramos que el reservation_type sea el correcto según lo detectado
        // También establecemos el campo 'servicio' con el valor del desplegable seleccionado
        // El campo 'estado_booking' siempre se establece como "Confirmed"
        const reservationsWithType = allReservationsData.map(reservation => ({
            ...reservation,
            reservation_type: reservation.aerolinea_vuelta ? reservationType : `${reservationType}_oneway`,
            servicio: reservationType, // El campo servicio toma el valor del desplegable (aereo, hotel, rent_a_car, tren)
            estado_booking: 'Confirmed' // El estado booking siempre debe ser "Confirmed"
        }));
        
        console.log(`BACKGROUND: Se extrajeron ${reservationsWithType.length} reservas con éxito.`);

        if (reservationsWithType.length > 0) {
            await chrome.storage.local.set({ savedReservationData: reservationsWithType });
            console.log("BACKGROUND: Datos guardados en chrome.storage.");
        }

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Captura Completada',
            message: `Se han procesado ${allReservationsData.length} reserva(s). Abre la extensión para ver los detalles.`
        });

    } catch (error) {
        console.error("BACKGROUND: Error en el proceso de captura:", error);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Error de Captura',
            message: `Ocurrió un error: ${error.message}`
        });
    }
}


/* ──────────────────────────────────────────────────────────────────────────
 *  1) Al hacer clic en el icono de la extensión                              
 * ────────────────────────────────────────────────────────────────────────── */
chrome.action.onClicked.addListener(async (tab) => {
  // Primero, nos aseguramos de que el content script esté inyectado.
  // La inyección no da error si el script ya fue inyectado antes.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['contentScript.js']
    });
    console.log("BACKGROUND: Inyección de contentScript.js asegurada.");

    // Una vez que estamos seguros de que el script existe, enviamos el mensaje.
    await chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
    console.log("BACKGROUND: Mensaje 'toggleUI' enviado con éxito a la pestaña", tab.id);

  } catch (error) {
    // Este error podría ocurrir si la página es protegida (ej: chrome://extensions)
    console.error(`BACKGROUND: Falló la inyección o el envío en la pestaña ${tab.id}:`, error);
    // Opcional: podrías notificar al usuario que la extensión no funciona en esta página.
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
   *  C) COMPROBAR INTEGRACIÓN APSYS  →  /api/me/integrations (NUEVO)
   * ════════════════════════════════════════════════════════════════════════ */
  else if (request.action === 'checkApsysIntegration') {
    console.log("Acción 'checkApsysIntegration' recibida.");
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
        fetch(`${API_BASE_URL}/api/get-fields-definition`)
        .then(response => response.json())
        .then(data => {
            // console.log("Respuesta de /get-fields-definition recibida, enviando al popup:", data);
            sendResponse(data);
        })
        .catch(error => {
            console.error("Error en el flujo de getFieldsDefinition:", error);
            sendResponse({ status: 'error', message: error.toString() });
        });
        return true; // Esencial para la asincronía
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
     *  ELIMINACIÓN DE CAMPOS COMPLETOS
     * ════════════════════════════════════════════════════════════════════════ */

    else if (request.action === 'deleteAllFieldSelectors') {
        const { apiKey, domain, fieldType, serviceType } = request;

        fetch(`${API_BASE_URL}/api/field-selectors/delete-all`, { // Nuevo endpoint
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                domain: domain,
                field_type: fieldType,
                service_type: serviceType
            })
        })
        .then(response => response.json())
        .then(data => sendResponse(data))
        .catch(err => sendResponse({ status: 'error', message: err.toString() }));

        return true; // Asíncrono
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

      const { apiKey, reservationsData } = request;

      if (!apiKey || !reservationsData) {
        sendResponse({ status: 'error', message: "Faltan datos (apiKey o reservationsData) para el guardado." });
        return true;
      }

      const serverUrl = `${API_BASE_URL}/api/save_all_reservations`;

      fetch(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          reservations_data: reservationsData, // La clave debe coincidir con la que espera el backend
          reservation_type: reservationsData[0].reservation_type || 'aereo' // todas las reservas son del mismo tipo
        })
      })
      .then(res => res.json())
      .then(data => {
          console.log("🛰️ Respuesta del servidor a /api/save_all_reservations:", data);
          sendResponse(data);
      })
      .catch(err => {
          console.error("❌ Error grave al llamar a /api/save_all_reservations:", err);
          sendResponse({ status: 'error', message: "Error de conexión en el guardado: " + err.toString() });
      });
      
      return true; // Esencial para la respuesta asíncrona
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  MANUAL FIELD MAPPING SYSTEM - Phase 1
     * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'openMappingWindow') {
        // Get current tab to pass domain info
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            let url = chrome.runtime.getURL('mapping.html');
            if (tabs && tabs.length > 0 && tabs[0] && tabs[0].url) {
                try {
                    const tabUrl = new URL(tabs[0].url);
                    // Pass domain as URL parameter
                    url += `?domain=${encodeURIComponent(tabUrl.hostname)}&tabId=${tabs[0].id}`;
                } catch (e) {
                    console.error('Error parsing tab URL:', e);
                }
            }
            // Open mapping window
            chrome.windows.create({
                url: url,
                type: 'popup',
                width: 600,
                height: 800
            });
        });
        sendResponse({ status: 'ok' });
        return true;
    }
    else if (request.action === 'openMappingUI') {
        // When Ctrl+Shift+. is pressed, open the extension popup on mapping tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.action.openPopup();
                // The popup will handle switching to mapping tab
            }
        });
        sendResponse({ status: 'ok' });
        return true;
    }
    
    else if (request.action === 'openMappingUIWithElement') {
        // When element is clicked in quick selection mode, open popup with element data
        // Store the element data temporarily
        chrome.storage.local.set({ 
            pendingElementMapping: {
                domain: request.domain,
                selector: request.selector,
                selectorType: request.selectorType,
                extractionMethod: request.extractionMethod,
                previewValue: request.previewValue
            }
        });
        
        // Open popup
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.action.openPopup();
            }
        });
        
        sendResponse({ status: 'ok' });
        return true;
    }
    
    else if (request.action === 'elementSelectedForMapping') {
        // Always save the state in case popup is closed
        chrome.storage.local.set({ 
            pendingMappingState: request,
            mappingDialogVisible: true
        }, () => {
            console.log('Background: Saved pending mapping state:', request);
        });
        
        // Try to forward the element selection to the popup
        // The popup will show the confirmation dialog if it's open
        chrome.runtime.sendMessage(request).catch(() => {
            // Popup is not open, state is already saved above
            console.log('Background: Popup not open, state saved for later');
        });
        sendResponse({ status: 'ok' });
        return true;
    }
    
    else if (request.action === 'mappingModeStarted' || request.action === 'mappingModeCancelled') {
        // Just acknowledge, no action needed
        sendResponse({ status: 'ok' });
        return true;
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  MANUAL FIELD MAPPING SYSTEM - API Proxy Handlers
     * ════════════════════════════════════════════════════════════════════════ */
    else if (request.action === 'getFieldSelectors') {
        const { apiKey, domain, fieldType, serviceType  } = request;
        
        if (!apiKey || !domain || !fieldType) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        const url = new URL(`${API_BASE_URL}/api/field-selectors`);
        url.searchParams.append('domain', domain);
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
    
    else if (request.action === 'saveFieldSelector') {
        const { apiKey, payload } = request;
        
        if (!apiKey || !payload) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        // Validar campos requeridos en el payload
        if (!payload.domain || !payload.field_name || !payload.selector_path) {
            console.error('BACKGROUND: Payload inválido - faltan campos requeridos:', payload);
            sendResponse({ 
                status: 'error', 
                message: 'Faltan campos requeridos: domain, field_name o selector_path' 
            });
            return true;
        }
        
        console.log('BACKGROUND: Guardando selector con payload:', JSON.stringify(payload, null, 2));
        
        fetch(`${API_BASE_URL}/api/field-selectors/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify(payload)
        })
        .then(async response => {
            // Verificar si la respuesta es OK antes de parsear JSON
            if (!response.ok) {
                // Intentar leer el mensaje de error del servidor
                let errorMessage = `Error del servidor: ${response.status} ${response.statusText}`;
                let errorDetails = null;
                let responseText = '';
                
                try {
                    // Clonar la respuesta para poder leerla sin consumirla
                    const clonedResponse = response.clone();
                    responseText = await clonedResponse.text();
                    
                    console.error(`BACKGROUND: Error ${response.status} del servidor. Respuesta:`, responseText);
                    
                    if (responseText) {
                        try {
                            const errorData = JSON.parse(responseText);
                            console.error('BACKGROUND: Error parseado como JSON:', errorData);
                            // El servidor puede devolver el error en diferentes formatos
                            errorMessage = errorData.message || errorData.error || errorData.detail || errorData.msg || errorMessage;
                            errorDetails = errorData;
                            
                            // Si hay un traceback o stack trace, incluirlo en el log pero no en el mensaje al usuario
                            if (errorData.traceback || errorData.stack) {
                                console.error('BACKGROUND: Stack trace del servidor:', errorData.traceback || errorData.stack);
                            }
                        } catch (jsonError) {
                            // Si no es JSON válido, usar el texto directamente
                            console.error('BACKGROUND: La respuesta no es JSON válido, usando texto:', responseText.substring(0, 500));
                            errorMessage = responseText.substring(0, 200) || errorMessage;
                        }
                    }
                } catch (e) {
                    // Si no se puede leer la respuesta, usar el mensaje por defecto
                    console.error('BACKGROUND: Error reading error response:', e);
                }
                
                // Log del payload que causó el error (sin API key por seguridad)
                const safePayload = { ...payload };
                console.error('BACKGROUND: Payload que causó el error:', JSON.stringify(safePayload, null, 2));
                
                // Crear un error con más información
                const serverError = new Error(errorMessage);
                serverError.status = response.status;
                serverError.statusText = response.statusText;
                serverError.details = errorDetails;
                serverError.responseText = responseText;
                throw serverError;
            }
            return response.json();
        })
        .then(data => {
            // Asegurarse de que la respuesta siempre tenga la estructura esperada
            if (!data) {
                sendResponse({ status: 'error', message: 'Respuesta vacía del servidor' });
                return;
            }
            sendResponse(data);
        })
        .catch(err => {
            console.error('BACKGROUND: Error saving field selector:', err);
            console.error('BACKGROUND: Error details:', {
                message: err.message,
                status: err.status,
                statusText: err.statusText,
                details: err.details,
                responseText: err.responseText ? err.responseText.substring(0, 500) : null,
                stack: err.stack
            });
            
            // Detectar tipo específico de error
            const errorString = err.toString();
            let errorMessage = err.message || err.toString() || 'Error desconocido al guardar el selector';
            
            // Si es un error del servidor (500, 502, 503, etc.)
            if (err.status && err.status >= 500) {
                // Intentar obtener más información del error
                let serverErrorMsg = 'El servidor encontró un error interno.';
                
                if (err.details) {
                    // Si hay detalles del error del servidor, intentar extraer información útil
                    if (err.details.message) {
                        serverErrorMsg = err.details.message;
                    } else if (err.details.error) {
                        serverErrorMsg = err.details.error;
                    } else if (typeof err.details === 'string') {
                        serverErrorMsg = err.details;
                    }
                } else if (err.responseText) {
                    // Si hay texto de respuesta, intentar extraer información
                    try {
                        const parsed = JSON.parse(err.responseText);
                        serverErrorMsg = parsed.message || parsed.error || parsed.detail || serverErrorMsg;
                    } catch (e) {
                        // Si no es JSON, usar las primeras líneas del texto
                        const lines = err.responseText.split('\n').filter(l => l.trim());
                        if (lines.length > 0) {
                            serverErrorMsg = lines[0].substring(0, 200);
                        }
                    }
                }
                
                // Si el mensaje es genérico "Internal server error", proporcionar más contexto
                if (serverErrorMsg === 'Internal server error' || serverErrorMsg.includes('Internal server error')) {
                    errorMessage = `Error del servidor (${err.status}): El servidor encontró un error interno al procesar la solicitud.\n\nPosibles causas:\n- El selector puede tener un formato no válido\n- Puede haber un conflicto con un mapeo existente\n- El servidor puede estar experimentando problemas temporales\n\nSugerencias:\n- Verifica que el selector sea válido: "${payload.selector_path}"\n- Intenta guardar el mapeo nuevamente\n- Si el problema persiste, contacta al soporte con los detalles del error\n\nInformación técnica:\n- Campo: ${payload.field_name}\n- Dominio: ${payload.domain}\n- Tipo de selector: ${payload.selector_type}`;
                } else {
                    errorMessage = `Error del servidor (${err.status}): ${serverErrorMsg}\n\nPor favor, verifica:\n- Que el selector sea válido\n- Que el campo no esté duplicado\n- Que tengas permisos para guardar mapeos\n\nSi el problema persiste, contacta al soporte.`;
                }
            } else if (err.status && err.status === 400) {
                errorMessage = `Error de validación (400): ${err.message || 'Los datos enviados no son válidos. Verifica el selector y los campos.'}`;
            } else if (err.status && err.status === 401) {
                errorMessage = `Error de autenticación (401): ${err.message || 'La API Key no es válida o ha expirado.'}`;
            } else if (err.status && err.status === 403) {
                errorMessage = `Error de permisos (403): ${err.message || 'No tienes permisos para realizar esta acción.'}`;
            } else if (err.status && err.status === 404) {
                errorMessage = `Error (404): ${err.message || 'El endpoint no fue encontrado.'}`;
            } else if (errorString.includes('Failed to fetch') || errorString.includes('NetworkError')) {
                errorMessage = 'Error de conexión: No se pudo conectar con el servidor. Verifica tu conexión a internet o intenta de nuevo más tarde.';
            } else if (errorString.includes('CORS')) {
                errorMessage = 'Error de CORS: El servidor no permite la conexión desde esta extensión.';
            } else if (errorString.includes('timeout')) {
                errorMessage = 'Timeout: El servidor tardó demasiado en responder. Intenta de nuevo.';
            }
            
            // Asegurarse de que siempre haya un mensaje
            if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '') {
                errorMessage = 'Error desconocido al guardar el selector. Por favor, intenta de nuevo.';
            }
            
            sendResponse({ status: 'error', message: errorMessage });
        });
        
        return true;
    }
    
    else if (request.action === 'findSelectorWithAI') {
        const { apiKey, fieldName, domain, fieldType, html } = request;
        
        if (!apiKey || !fieldName || !domain || !html) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        // Llamar a la API para que la IA encuentre el selector
        fetch(`${API_BASE_URL}/api/find-selector`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                field_name: fieldName,
                domain: domain,
                field_type: fieldType || 'capture',
                html: html
            })
        })
        .then(response => response.json())
        .then(data => {
            sendResponse(data);
        })
        .catch(err => {
            console.error('Error finding selector with AI:', err);
            sendResponse({ status: 'error', message: err.toString() });
        });
        
        return true;
    }
    
    // NUEVO: Buscar selectores para múltiples campos a la vez (endpoint plural - eficiente)
    else if (request.action === 'findSelectorsWithAI') {
        const { apiKey, fieldNames, domain, fieldType, html } = request;
        
        if (!apiKey || !fieldNames || !Array.isArray(fieldNames) || fieldNames.length === 0 || !domain || !html) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        // ✅ EFICIENTE: Una sola llamada al endpoint plural con todos los campos
        console.log(`[FIND-SELECTORS] Iniciando busqueda para ${fieldNames.length} campos`);
        console.log(`[FIND-SELECTORS] Tamano del HTML: ${(html.length / 1024).toFixed(2)} KB`);
        console.log(`[FIND-SELECTORS] Intentando endpoint PLURAL: ${API_BASE_URL}/api/find-selectors`);
        
        // Intentar primero con el endpoint plural
        const startTime = Date.now();
        
        // Calcular timeout dinámico basado en el número de campos
        // Base: 30 segundos + 1 segundo por cada campo (mínimo 60s, máximo 300s)
        const dynamicTimeout = Math.min(Math.max(60000 + (fieldNames.length * 2000), 120000), 300000);
        console.log(`[FIND-SELECTORS] Timeout configurado: ${dynamicTimeout / 1000}s (${fieldNames.length} campos)`);
        
        // Crear un AbortController para timeout dinámico
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.error(`[FIND-SELECTORS] Timeout de 5 minutos alcanzado.`);
        }, 500000);
        
        fetch(`${API_BASE_URL}/api/find-selectors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                field_names: fieldNames,
                domain: domain,
                field_type: fieldType || 'capture',
                html: html
            }),
            signal: controller.signal
        })
        .then(response => {
            clearTimeout(timeoutId); // Limpiar timeout si la respuesta llega
            const elapsedTime = Date.now() - startTime;
            console.log(`[FIND-SELECTORS] Respuesta del endpoint PLURAL recibida en ${elapsedTime}ms`);
            console.log(`[FIND-SELECTORS] Status: ${response.status} ${response.statusText}`);
            
            // Verificar si la respuesta es OK antes de parsear JSON
            if (!response.ok) {
                console.error(`[FIND-SELECTORS] ❌ Endpoint plural devolvio error HTTP: ${response.status}`);
                console.error(`[FIND-SELECTORS] Headers de respuesta:`, Object.fromEntries(response.headers.entries()));
                
                // Si la respuesta no es OK, intentar leer el mensaje de error
                return response.text().then(text => {
                    console.error(`[FIND-SELECTORS] Cuerpo de error:`, text.substring(0, 500));
                    try {
                        const errorData = JSON.parse(text);
                        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
                    } catch (e) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}. ${text.substring(0, 200) || ''}`);
                    }
                });
            }
            return response.json();
        })
        .then(data => {
            console.log(`[FIND-SELECTORS] EXITO con endpoint PLURAL`);
            console.log(`[FIND-SELECTORS] Selectores encontrados: ${data.selectors ? Object.keys(data.selectors).length : 0}`);
            
            // El endpoint devuelve directamente los selectores en el formato esperado
            if (data.status === 'success' && data.selectors) {
                // Normalizar la respuesta para asegurar que todos los campos tengan el formato correcto
                const normalizedSelectors = {};
                Object.entries(data.selectors).forEach(([fieldName, selectorData]) => {
                    normalizedSelectors[fieldName] = {
                        selector: selectorData.selector || selectorData.selector_path || '',
                        selector_path: selectorData.selector_path || selectorData.selector || '',
                        selector_type: selectorData.selector_type || 'css',
                        extraction_method: selectorData.extraction_method || 'textContent',
                        preview_value: selectorData.preview_value || ''
                    };
                });
                
                sendResponse({
                    status: 'success',
                    selectors: normalizedSelectors,
                    found: Object.keys(normalizedSelectors).length,
                    total: fieldNames.length
                });
            } else {
                sendResponse({
                    status: 'error',
                    message: data.message || 'No se encontraron selectores'
                });
            }
        })
        .catch(err => {
            clearTimeout(timeoutId); // Limpiar timeout en caso de error
            const elapsedTime = Date.now() - startTime;
            console.error(`[FIND-SELECTORS] ❌ Error con endpoint PLURAL despues de ${elapsedTime}ms`);
            console.error(`[FIND-SELECTORS] Tipo de error: ${err.name || 'Unknown'}`);
            console.error(`[FIND-SELECTORS] Mensaje: ${err.message || err.toString()}`);
            console.error(`[FIND-SELECTORS] Stack:`, err.stack);
            
            // Detectar tipo específico de error
            const errorString = err.toString();
            const isTimeout = err.name === 'AbortError' || errorString.includes('timeout') || errorString.includes('aborted');
            const isCORS = errorString.includes('CORS') || errorString.includes('Failed to fetch') || errorString.includes('NetworkError');
            const isNetwork = errorString.includes('network') || errorString.includes('NetworkError') || errorString.includes('fetch');
            const isServerError = errorString.includes('500') || errorString.includes('503') || errorString.includes('502');
            
            console.error(`[FIND-SELECTORS] Analisis del error:`);
            console.error(`  - Timeout: ${isTimeout}`);
            console.error(`  - CORS: ${isCORS}`);
            console.error(`  - Network: ${isNetwork}`);
            console.error(`  - Server Error: ${isServerError}`);
            
            // Si falla por CORS u otro error, hacer fallback al endpoint singular
            if (isCORS || isNetwork) {
                console.warn(`[FIND-SELECTORS] FALLBACK: Cambiando a endpoint SINGULAR debido a error CORS`);
                console.warn(`[FIND-SELECTORS] Se haran ${fieldNames.length} llamadas individuales`);
                console.warn(`[FIND-SELECTORS] Cada llamada enviara ${(html.length / 1024).toFixed(2)} KB de HTML`);
                
                const fallbackStartTime = Date.now();
                
                // Hacer llamadas individuales al endpoint singular que sí funciona
                const promises = fieldNames.map((fieldName, index) => {
                    if (index % 10 === 0) {
                        console.log(`[FALLBACK] Procesando campo ${index + 1}/${fieldNames.length}: ${fieldName}`);
                    }
                    return fetch(`${API_BASE_URL}/api/find-selector`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': apiKey
                        },
                        body: JSON.stringify({
                            field_name: fieldName,
                            domain: domain,
                            field_type: fieldType || 'capture',
                            html: html
                        })
                    })
                    .then(response => response.json())
                    .then(data => ({ fieldName, data }))
                    .catch(error => ({ fieldName, error: error.toString() }));
                });
                
                Promise.all(promises)
                    .then(results => {
                        const fallbackElapsedTime = Date.now() - fallbackStartTime;
                        console.log(`[FALLBACK] Todas las llamadas completadas en ${fallbackElapsedTime}ms`);
                        console.log(`[FALLBACK] Total de llamadas: ${results.length}`);
                        
                        const selectors = {};
                        const errors = {};
                        
                        results.forEach(({ fieldName, data, error }) => {
                            if (error) {
                                errors[fieldName] = error;
                            } else if (data.status === 'success' && data.selector) {
                                selectors[fieldName] = {
                                    selector: data.selector || data.selector_path || '',
                                    selector_path: data.selector_path || data.selector || '',
                                    selector_type: data.selector_type || 'css',
                                    extraction_method: data.extraction_method || 'textContent',
                                    preview_value: data.preview_value || ''
                                };
                            } else {
                                errors[fieldName] = data.message || 'No se encontro selector';
                            }
                        });
                        
                        console.log(`[FALLBACK] Selectores encontrados: ${Object.keys(selectors).length}`);
                        console.log(`[FALLBACK] Errores: ${Object.keys(errors).length}`);
                        console.log(`[FALLBACK] Tiempo promedio por campo: ${(fallbackElapsedTime / fieldNames.length).toFixed(2)}ms`);
                        
                        sendResponse({
                            status: 'success',
                            selectors: selectors,
                            found: Object.keys(selectors).length,
                            total: fieldNames.length,
                            errors: Object.keys(errors).length > 0 ? errors : undefined
                        });
                    })
                    .catch(fallbackError => {
                        const fallbackElapsedTime = Date.now() - fallbackStartTime;
                        console.error(`[FALLBACK] Error en fallback despues de ${fallbackElapsedTime}ms:`, fallbackError);
                        sendResponse({ 
                            status: 'error', 
                            message: `Error de conexion. El endpoint plural tiene problemas de CORS y el fallback tambien fallo: ${fallbackError.toString()}` 
                        });
                    });
            } else if (isTimeout) {
                // Si es timeout, sugerir reintento
                const timeoutSeconds = dynamicTimeout / 1000;
                console.error(`[FIND-SELECTORS] ⏱️ Timeout: El servidor tardo mas de ${timeoutSeconds} segundos`);
                console.error(`[FIND-SELECTORS] Procesando ${fieldNames.length} campos puede tardar mas tiempo`);
                sendResponse({ 
                    status: 'error', 
                    message: `Timeout: El servidor tardó más de ${timeoutSeconds} segundos procesando ${fieldNames.length} campos. La IA puede necesitar más tiempo para procesar muchos campos. Intenta de nuevo o reduce el número de campos seleccionados.` 
                });
            } else if (isServerError) {
                // Si es error del servidor, sugerir reintento
                console.error(`[FIND-SELECTORS] 🖥️ Error del servidor`);
                sendResponse({ 
                    status: 'error', 
                    message: `Error del servidor (${err.message}). El servidor puede estar sobrecargado. Intenta de nuevo en unos momentos.` 
                });
            } else {
                // Si no es error de CORS, devolver el error original
                console.error(`[FIND-SELECTORS] ❌ Error no relacionado con CORS/Network, no se usara fallback`);
                sendResponse({ status: 'error', message: err.message || err.toString() });
            }
        });
        
        return true;
    }
    
    else if (request.action === 'deleteFieldSelector') {
        const { apiKey, domain, fieldName, fieldType , serviceType } = request;
        
        if (!apiKey || !domain || !fieldName || !fieldType) {
            sendResponse({ status: 'error', message: 'Missing required parameters' });
            return true;
        }
        
        fetch(`${API_BASE_URL}/api/field-selectors/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            },
            body: JSON.stringify({
                domain: domain,
                field_name: fieldName,
                field_type: fieldType,
                service_type: serviceType || 'aereo'
            })
        })
        .then(response => response.json())
        .then(data => {
            sendResponse(data);
        })
        .catch(err => {
            console.error('Error deleting field selector:', err);
            sendResponse({ status: 'error', message: err.toString() });
        });
        
        return true;
    }
});

// Listener para comandos de teclado (atajos)
chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-mapping-window') {
        // Obtener la pestaña activa para pasar información del dominio
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            let url = chrome.runtime.getURL('mapping.html');
            if (tabs && tabs.length > 0 && tabs[0] && tabs[0].url) {
                try {
                    const tabUrl = new URL(tabs[0].url);
                    // Pasar dominio como parámetro de URL
                    url += `?domain=${encodeURIComponent(tabUrl.hostname)}&tabId=${tabs[0].id}`;
                } catch (e) {
                    console.error('Error parsing tab URL:', e);
                }
            }
            // Abrir ventana de mapeo
            chrome.windows.create({
                url: url,
                type: 'popup',
                width: 600,
                height: 800
            });
        });
    }
});