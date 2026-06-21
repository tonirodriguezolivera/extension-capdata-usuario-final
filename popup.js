// popup.js (VERSIÓN FINAL Y LIMPIA CON PESTAÑAS) 

let STANDARD_FIELDS = [];
let AVSIS_SPECIFIC_FIELDS = [];
let GESINTUR_BILETE_FIELDS = [];
let GESINTUR_NORMAL_FIELDS = [];
let PIPELINE_ORBISWEB_FIELDS = [];
let cachedAvsisStatus = false;
let cachedGesinturStatus = false;
let cachedOrbiswebStatus = false;
/** Visibilidad de integraciones en formulario, estructura webhook y payload (global para todos los usuarios; se obtiene del backend) */
let cachedIntegrationVisibility = { avsis: true, gesintur: true, orbisweb: true };
/** Visibilidad por campo dentro de cada integración: { avsis: { num_bono: 0, psb: 1 }, orbisweb: {}, gesintur: {} } (0=oculto, 1=visible) */
let cachedIntegrationFieldVisibility = { avsis: {}, orbisweb: {}, gesintur: {} };
/** Visibilidad de campos estándar (solo UI): integration > owner > default visible */
let cachedStandardFieldVisibility = {};
let selectedReservationType = null;
let selectedOrbiswebType = null;
let allContacts = [];
let filteredContacts = [];
let currentPage = 1;
const CONTACTS_PER_PAGE = 10;
let selectedContact = null;
let currentFolderId = null; // null = Raíz
let currentFolderName = 'Inicio';
let _airlinesIataCache = null;
const CAPTURE_HIDE_EMPTY_RULES_KEY = 'captureHideWhenEmptyRules';
const CAPTURE_VIEW_STATE_KEY = 'captureViewState';
const STANDARD_FIELD_VISIBILITY_REFRESH_KEY = 'standardFieldVisibilityRefreshTs';
const INTEGRATION_FIELD_VISIBILITY_REFRESH_KEY = 'integrationFieldVisibilityRefreshTs';
let captureHideWhenEmptyRules = {};
let currentCaptureDomain = '';
let isLastCaptureSavedLocked = false;

async function loadStandardFieldVisibilityForPopup(apiKey) {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getStandardFieldVisibility', apiKey });
        const stdVisibility = (res && typeof res === 'object' && res.field_visibility && typeof res.field_visibility === 'object')
            ? res.field_visibility
            : {};
        cachedStandardFieldVisibility = {};
        Object.entries(stdVisibility).forEach(([k, v]) => {
            const key = String(k || '').trim().toLowerCase();
            if (!key) return;
            cachedStandardFieldVisibility[key] = (v === 0 || v === false || v === '0') ? 0 : 1;
        });
    } catch (_) {
        // Silencioso: si falla, se mantiene el último estado en memoria.
    }
}

async function getAirlinesIataMap() {
    if (_airlinesIataCache) return _airlinesIataCache;
    try {
        const url = chrome.runtime.getURL('airlines-iata.json');
        const res = await fetch(url);
        _airlinesIataCache = await res.json();
    } catch (e) {
        console.warn('POPUP: No se pudo cargar airlines-iata.json:', e);
        _airlinesIataCache = {};
    }
    return _airlinesIataCache;
}

function normalizeAirlineLookup(value) {
    if (!value) return '';
    return String(value)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getBrandFromDomainLike(value) {
    if (!value) return '';
    let host = String(value).trim().toLowerCase();
    host = host.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].replace(/^www\./i, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return normalizeAirlineLookup(parts[0]);
    const isDoubleTLD = parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length <= 3;
    const brand = isDoubleTLD ? parts[parts.length - 3] : parts[parts.length - 2];
    return normalizeAirlineLookup(brand || parts[0]);
}

async function getActiveSiteUrl() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tabs?.[0]?.url || '';
        if (!currentUrl) return '';
        if (!/^https?:\/\//i.test(currentUrl)) return '';
        return currentUrl;
    } catch (_error) {
        return '';
    }
}

function lookupAirlineCode(providerName, airlinesMap) {
    if (!providerName || !airlinesMap) return null;
    const normalizedProvider = normalizeAirlineLookup(providerName);
    const brandProvider = getBrandFromDomainLike(providerName);
    const candidates = [normalizedProvider, brandProvider].filter(Boolean);

    for (const candidate of candidates) {
        if (airlinesMap[candidate]) return airlinesMap[candidate];
    }

    const tokens = normalizedProvider.split(' ').filter((t) => t.length >= 3);
    for (const token of tokens) {
        if (airlinesMap[token]) return airlinesMap[token];
    }

    return null;
}

function extractIataCode(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const exactCode = raw.match(/^[A-Z]{3}$/i);
    if (exactCode) return exactCode[0].toUpperCase();
    const embeddedCode = raw.match(/\b([A-Z]{3})\b/i);
    return embeddedCode ? embeddedCode[1].toUpperCase() : '';
}

function getFlightRouteIata(data) {
    if (!data || typeof data !== 'object') return { origen: '', destino: '' };

    const origenCandidates = [
        data.Ida_Origen_Lugar,
        data.aeropuerto_salida_ida,
        data.origen
    ];
    const destinoCandidates = [
        data.Ida_Destino_Lugar,
        data.aeropuerto_llegada_ida,
        data.destino
    ];

    const origen = origenCandidates.map(extractIataCode).find(Boolean) || '';
    const destino = destinoCandidates.map(extractIataCode).find(Boolean) || '';
    return { origen, destino };
}

function buildGenericFlightDescription(data) {
    const { origen, destino } = getFlightRouteIata(data);
    if (!origen || !destino) return null;
    return `vuelo ${origen} ${destino}`;
}

function normalizeFieldSlug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GESINTUR_FIELD_ALIAS_GROUPS = [
    ['accion'],
    ['codigo_oficina', 'cod_oficina'],
    ['codigo_expediente', 'cod_expediente'],
    ['accion_facturacion']
];

const GIAV_LABEL_OVERRIDES = {
    codigooficina: 'Cód. Oficina (Ej. 0000)',
    codoficina: 'Cód. Oficina (Ej. 0000)',
    codigoexpediente: 'Cód. Expediente (Ej. 2600014)',
    codexpediente: 'Cód. Expediente (Ej. 2600014)'
};

const GIAV_SELECT_OPTION_LABELS = {
    accion: {
        solo_captura: 'Solo captura',
        volcar_expediente: 'Volcar a expediente'
    },
    accion_facturacion: {
        ninguna: 'Ninguna',
        facturar_cliente: 'Facturar a cliente',
        facturar_pasajeros: 'Facturar a pasajeros'
    }
};

function getGiavFieldLabelOverride(fieldName, fallbackLabel) {
    const normalizedField = normalizeFieldSlug(fieldName);
    return GIAV_LABEL_OVERRIDES[normalizedField] || fallbackLabel;
}

function getGiavSelectOptionLabel(fieldName, optionValue) {
    const fieldLabels = GIAV_SELECT_OPTION_LABELS[String(fieldName || '').toLowerCase()];
    if (!fieldLabels) return optionValue || '-- Seleccionar --';
    return fieldLabels[String(optionValue)] || optionValue || '-- Seleccionar --';
}

function getGesinturFieldAliases(fieldName) {
    const normalizedField = normalizeFieldSlug(fieldName);
    const group = GESINTUR_FIELD_ALIAS_GROUPS.find((aliases) =>
        aliases.some((alias) => normalizeFieldSlug(alias) === normalizedField)
    );
    return group ? [...group] : [String(fieldName || '')];
}

function resolveGesinturFieldForRender(baseField, data = null, schemaCandidates = null) {
    const aliases = getGesinturFieldAliases(baseField);
    const dataObj = (data && typeof data === 'object') ? data : null;
    if (dataObj) {
        const preferredFromData = aliases.find((alias) => Object.prototype.hasOwnProperty.call(dataObj, alias));
        if (preferredFromData) return preferredFromData;
    }
    if (schemaCandidates instanceof Set && schemaCandidates.size > 0) {
        const preferredFromSchema = aliases.find((alias) => schemaCandidates.has(alias));
        if (preferredFromSchema) return preferredFromSchema;
    }
    return aliases[0];
}

function getGesinturFieldValue(data, baseField) {
    const dataObj = (data && typeof data === 'object') ? data : null;
    if (!dataObj) return '';
    const aliases = getGesinturFieldAliases(baseField);
    const preferredAlias = aliases.find((alias) => Object.prototype.hasOwnProperty.call(dataObj, alias));
    if (preferredAlias) return dataObj[preferredAlias];
    return '';
}

function findFirstFieldByNormalizedName(fields, acceptedNormalizedNames) {
    if (!Array.isArray(fields)) return null;
    return fields.find((field) => acceptedNormalizedNames.includes(normalizeFieldSlug(field))) || null;
}

function getGeneralLocatorValue(index, reservationData = null) {
    const hasText = (value) => value !== null && value !== undefined && String(value).trim() !== '';
    const acceptedLocatorKeys = new Set(['strlocalizador', 'localizador', 'codigoreserva']);

    // Prioridad 1: lo que el usuario tiene ahora mismo en el DOM (edición manual más reciente).
    const directDomIds = [
        `pipeline_strlocalizador_${index}`,
        `localizador_${index}`,
        `codigo_reserva_${index}`
    ];
    for (const inputId of directDomIds) {
        const input = document.getElementById(inputId);
        if (input && hasText(input.value)) return String(input.value).trim();
    }

    const pipelineInputsForReservation = Array.from(
        document.querySelectorAll(`input[id^="pipeline_"][id$="_${index}"], select[id^="pipeline_"][id$="_${index}"], textarea[id^="pipeline_"][id$="_${index}"]`)
    );
    const dynamicLocatorInput = pipelineInputsForReservation.find((input) => {
        const id = String(input.id || '');
        const prefix = 'pipeline_';
        const suffix = `_${index}`;
        if (!id.startsWith(prefix) || !id.endsWith(suffix)) return false;
        const fieldName = id.slice(prefix.length, id.length - suffix.length);
        return acceptedLocatorKeys.has(normalizeFieldSlug(fieldName));
    });
    if (dynamicLocatorInput && hasText(dynamicLocatorInput.value)) {
        return String(dynamicLocatorInput.value).trim();
    }

    // Prioridad 2: datos en memoria (fallback).
    const fromDataCandidates = [];
    if (reservationData && typeof reservationData === 'object') {
        for (const [key, value] of Object.entries(reservationData)) {
            if (acceptedLocatorKeys.has(normalizeFieldSlug(key))) {
                fromDataCandidates.push(value);
            }
        }
    }
    const dataValue = fromDataCandidates.find(hasText);
    if (dataValue) return String(dataValue).trim();

    return '';
}

function syncLocatorFamilyValues(targetData, localizadorGeneral, pipelineFields = null) {
    if (!targetData || typeof targetData !== 'object') return;
    if (localizadorGeneral === null || localizadorGeneral === undefined) return;
    const normalizedValue = String(localizadorGeneral).trim();
    if (!normalizedValue) return;

    // Campos base de la extensión: deben reflejar siempre el valor manual más reciente.
    targetData.localizador = normalizedValue;
    targetData.codigo_reserva = normalizedValue;

    // Campos ORBISWEB equivalentes (con tolerancia a variaciones de naming).
    const fieldPool = Array.isArray(pipelineFields) ? pipelineFields : [];
    const locatorFieldName = findFirstFieldByNormalizedName(fieldPool, ['strlocalizador']) || 'strlocalizador';
    const pnrFieldName = findFirstFieldByNormalizedName(fieldPool, ['strlocalizadorpnr']) || 'strlocalizadorpnr';
    const gdsFieldName = findFirstFieldByNormalizedName(fieldPool, ['strlocalizadorgds']) || 'strlocalizadorgds';

    targetData[locatorFieldName] = normalizedValue;
    targetData[pnrFieldName] = normalizedValue;
    targetData[gdsFieldName] = normalizedValue;
}

function getReservationTypeBase(reservationType) {
    const rawType = String(reservationType || '').trim().toLowerCase();
    if (!rawType) return 'aereo';
    return rawType.split('_')[0] || 'aereo';
}

function normalizeTicketNumberValue(rawValue) {
    return String(rawValue ?? '').replace(/\D+/g, '');
}

function isGiavReservationFlow(reservationType) {
    const baseType = getReservationTypeBase(reservationType);
    const isFlightFlow = reservationType === 'billetaje' || baseType === 'aereo';
    const isGesinturFlow = cachedGesinturStatus;
    const isGiavFlow = !cachedAvsisStatus && !cachedGesinturStatus && !cachedOrbiswebStatus;
    return isFlightFlow && (isGesinturFlow || isGiavFlow);
}

function isGiavIntegrationActive() {
    return cachedGesinturStatus === true && cachedIntegrationVisibility.gesintur !== false;
}

function updateGiavContactsVisibility() {
    const contactsTabBtn = document.querySelector('.tab-btn[data-tab="fillContent"]');
    const contactsPane = document.getElementById('fillContent');
    if (contactsTabBtn) contactsTabBtn.style.display = '';
    if (contactsPane) contactsPane.style.display = '';
}

function getGiavAwareSaveSuccessMessage(message) {
    const rawMessage = String(message ?? '').trim();
    if (!isGiavIntegrationActive() || !rawMessage) return rawMessage;
    return rawMessage
        .replace(/\s+y\s+\d+\s+contacto\(s\)\s+nuevo\(s\)\s+creado\(s\)\.?/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function applyExclusiveGestionFields(fields, reservationType) {
    const normalizedNumImporteSf = 'numimportesf';
    const normalizedNumGastoGestion = 'numgastogestion';
    const isAereo = getReservationTypeBase(reservationType) === 'aereo';
    const sourceFields = Array.isArray(fields) ? fields : [];
    let detectedNumGastoGestionField = null;

    const filteredFields = sourceFields.filter((fieldName) => {
        const normalizedField = normalizeFieldSlug(fieldName);
        if (normalizedField === normalizedNumGastoGestion) {
            if (!detectedNumGastoGestionField) detectedNumGastoGestionField = fieldName;
            return !isAereo;
        }
        if (normalizedField === normalizedNumImporteSf) {
            return isAereo;
        }
        return true;
    });

    if (!isAereo && !detectedNumGastoGestionField) {
        filteredFields.push('Numgastogestión');
    }

    return [...new Set(filteredFields)];
}

function enforceExclusiveGestionFieldsInPayload(data, reservationType, candidateFieldNames = []) {
    if (!data || typeof data !== 'object') return;

    const normalizedNumImporteSf = 'numimportesf';
    const normalizedNumGastoGestion = 'numgastogestion';
    const isAereo = getReservationTypeBase(reservationType) === 'aereo';

    Object.keys(data).forEach((fieldName) => {
        const normalizedField = normalizeFieldSlug(fieldName);
        if (isAereo && normalizedField === normalizedNumGastoGestion) {
            delete data[fieldName];
        }
        if (!isAereo && normalizedField === normalizedNumImporteSf) {
            delete data[fieldName];
        }
    });

    if (!isAereo) {
        const hasNumGastoGestion = Object.keys(data).some(
            (fieldName) => normalizeFieldSlug(fieldName) === normalizedNumGastoGestion
        );
        if (!hasNumGastoGestion) {
            const preferredNumGastoGestionField = findFirstFieldByNormalizedName(
                candidateFieldNames,
                [normalizedNumGastoGestion]
            ) || 'Numgastogestión';
            data[preferredNumGastoGestionField] = null;
        }
    }
}

/**
 * Resuelve nombre lógico del campo e índice de reserva desde un input del formulario.
 * Los ids siguen `{slug}_{resIndex}` o prefijos `pipeline_`, `gesintur_`, `avsis_`.
 * No usar split('_')[0]: rompe slugs con guion bajo (p. ej. codigo_reserva, campos personalizados).
 */
function parseRootFormInputMeta(target) {
    if (!target) return { field: null, resIdx: null };
    const dsField = target.dataset && target.dataset.field;
    const dsIdx = target.dataset && target.dataset.index;
    if (dsField != null && dsField !== '' && dsIdx != null && dsIdx !== '') {
        return { field: dsField, resIdx: String(dsIdx) };
    }
    const id = target.id;
    if (!id || typeof id !== 'string') return { field: null, resIdx: null };
    let m = id.match(/^pipeline_(.+)_(\d+)$/);
    if (m) return { field: m[1], resIdx: m[2] };
    m = id.match(/^gesintur_(.+)_(\d+)$/);
    if (m) return { field: m[1], resIdx: m[2] };
    m = id.match(/^avsis_(.+)_(\d+)$/);
    if (m) return { field: m[1], resIdx: m[2] };
    m = id.match(/^(.+)_(\d+)$/);
    if (m) return { field: m[1], resIdx: m[2] };
    return { field: null, resIdx: null };
}

function notifySizeChange() {
    // Usamos scrollHeight para obtener la altura total del contenido
    // También consideramos offsetHeight para asegurar que capturamos todo
    const height = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
    );
    // Verificar que chrome.runtime esté disponible antes de usarlo
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            chrome.runtime.sendMessage({ action: 'resizeIframe', height: height });
        } catch (error) {
            // Ignorar errores de contexto invalidado
            if (!error.message || !error.message.includes('Extension context invalidated')) {
                console.warn('Error al enviar mensaje de resize:', error);
            }
        }
    }
}

const observer = new ResizeObserver(entries => {
    notifySizeChange();
});

observer.observe(document.body);

// ════════════════════════════════════════════════════════════════════════
//  EXPEDIENTES ORBISWEB — pestaña de histórico (solo si la integración activa)
// ════════════════════════════════════════════════════════════════════════
let orbisExpedientesLoaded = false;
let orbisExpFilterTimer = null;

function applyOrbisExpedientesTabVisibility() {
    const btn = document.getElementById('expedientesTabBtn');
    if (!btn) return;
    btn.style.display = cachedOrbiswebStatus ? '' : 'none';
    // Si se desactiva mientras estaba activa la pestaña, volvemos a Captura.
    if (!cachedOrbiswebStatus && btn.classList.contains('active')) {
        const capBtn = document.querySelector('.tab-btn[data-tab="captureContent"]');
        if (capBtn) capBtn.click();
    }
}

function _orbisEsc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, s => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]
    ));
}

function _orbisFmtDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(iso); }
}

async function _orbisGetApiKey() {
    // Preferimos el valor "vivo" del campo de la API Key (lo que usa el flujo de
    // captura/guardado). Solo si está vacío caemos al valor guardado en storage
    // (que únicamente se rellena al pulsar "Guardar API Key").
    const fromInput = (document.getElementById('apiKey')?.value || '').trim();
    if (fromInput) return fromInput;
    const { userApiKey } = await chrome.storage.local.get('userApiKey');
    return userApiKey || null;
}

function backToOrbisExpedientesList() {
    const listView = document.getElementById('orbisExpedientesListView');
    const detailView = document.getElementById('orbisExpedienteDetail');
    if (detailView) detailView.style.display = 'none';
    if (listView) listView.style.display = 'block';
}

function _renderOrbisExpedienteRow(e) {
    const num = (e.num_id_expediente != null) ? e.num_id_expediente : '—';
    const code = e.str_expediente ? ` · ${_orbisEsc(e.str_expediente)}` : '';
    const titular = e.titular ? _orbisEsc(e.titular) : 'Sin titular';
    const updated = e.updated_at ? _orbisFmtDate(e.updated_at) : '';
    return `
      <div class="orbis-exp-row" data-exp-id="${e.id}" data-exp-num="${_orbisEsc(num)}"
           style="border:1px solid #e0e0e0; border-radius:6px; padding:10px; margin-bottom:8px; cursor:pointer; background:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <strong style="color:#0672ff; font-size:13px;">Expediente ${_orbisEsc(num)}${code}</strong>
          <span style="color:#0672ff; font-size:12px; white-space:nowrap;">Ver servicios →</span>
        </div>
        <div style="font-size:12px; color:#555; margin-top:4px;">${titular}</div>
        ${updated ? `<div style="font-size:11px; color:#999; margin-top:2px;">Actualizado en CapData: ${_orbisEsc(updated)}</div>` : ''}
      </div>`;
}

// Renderiza un servicio LEÍDO EN VIVO de Orbis (forma mapeada por el backend).
function _renderOrbisServicioRow(s) {
    const desc = s.descripcion ? _orbisEsc(s.descripcion)
        : (s.localizador ? `Reserva ${_orbisEsc(s.localizador)}` : 'Servicio');
    const titular = s.titular ? _orbisEsc(s.titular) : '';
    const prov = s.proveedor ? _orbisEsc(s.proveedor)
        : (s.num_id_proveedor ? `Proveedor ${_orbisEsc(s.num_id_proveedor)}` : '');
    const importe = (s.importe != null) ? `${_orbisEsc(s.importe)} ${_orbisEsc(s.divisa || 'EUR')}`.trim() : '';
    const fecha = s.fecha_servicio ? _orbisEsc(s.fecha_servicio) : '';
    const numServ = s.num_servicio ? `Servicio ${_orbisEsc(s.num_servicio)}` : '';
    const anulado = !!s.anulado;
    return `
      <div style="border:1px solid #e8e8e8; border-radius:6px; padding:10px; margin-bottom:8px; background:${anulado ? '#fdf2f2' : '#fafafa'};">
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <strong style="font-size:13px;${anulado ? ' text-decoration:line-through; color:#b91c1c;' : ''}">${desc}</strong>
          ${importe ? `<span style="white-space:nowrap; font-size:12px; color:#333;">${importe}</span>` : ''}
        </div>
        ${titular ? `<div style="font-size:12px; color:#333; margin-top:3px;">👤 ${titular}</div>` : ''}
        ${prov ? `<div style="font-size:12px; color:#555; margin-top:2px;">🏢 ${prov}</div>` : ''}
        <div style="font-size:11px; color:#999; margin-top:5px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          ${fecha ? `<span>📅 ${fecha}</span>` : ''}
          ${numServ ? `<span>${numServ}</span>` : ''}
          ${s.localizador ? `<span>Loc: ${_orbisEsc(s.localizador)}</span>` : ''}
          ${s.billete ? `<span>Billete: ${_orbisEsc(s.billete)}</span>` : ''}
          ${anulado ? `<span style="color:#b91c1c; font-weight:600;">ANULADO</span>` : ''}
        </div>
      </div>`;
}

async function loadOrbisExpedientes(query) {
    const listEl = document.getElementById('orbisExpedientesList');
    if (!listEl) return;
    const apiKey = await _orbisGetApiKey();
    if (!apiKey) {
        listEl.innerHTML = '<p class="status-text">Guarda tu API Key para ver los expedientes.</p>';
        return;
    }
    listEl.innerHTML = '<p class="status-text">Cargando expedientes...</p>';
    let data;
    try {
        data = await chrome.runtime.sendMessage({ action: 'getOrbisExpedientes', apiKey, q: query || '' });
    } catch (e) {
        listEl.innerHTML = `<p class="status-text" style="color:#dc3545;">Error: ${_orbisEsc(e.message || e)}</p>`;
        return;
    }
    if (!data || data.status !== 'success') {
        listEl.innerHTML = `<p class="status-text" style="color:#dc3545;">${_orbisEsc((data && data.message) || 'No se pudieron cargar los expedientes.')}</p>`;
        return;
    }
    const exps = data.expedientes || [];
    orbisExpedientesLoaded = true;
    if (!exps.length) {
        listEl.innerHTML = '<p class="status-text">No hay expedientes registrados desde CapData todavía.</p>';
        return;
    }
    listEl.innerHTML = exps.map(_renderOrbisExpedienteRow).join('');
    listEl.querySelectorAll('[data-exp-id]').forEach(row => {
        row.addEventListener('click', () => openOrbisExpedienteDetail(
            row.getAttribute('data-exp-id'),
            row.getAttribute('data-exp-num')
        ));
    });
    notifySizeChange();
}

async function openOrbisExpedienteDetail(expId, expNum) {
    const listView = document.getElementById('orbisExpedientesListView');
    const detailView = document.getElementById('orbisExpedienteDetail');
    const titleEl = document.getElementById('orbisExpedienteDetailTitle');
    const servEl = document.getElementById('orbisExpedienteServiciosList');
    if (!detailView || !servEl) return;
    if (listView) listView.style.display = 'none';
    detailView.style.display = 'block';
    if (titleEl) titleEl.textContent = `Expediente ${expNum || ''}`.trim();
    servEl.innerHTML = '<p class="status-text">Cargando servicios...</p>';
    notifySizeChange();

    const apiKey = await _orbisGetApiKey();
    if (!apiKey) { servEl.innerHTML = '<p class="status-text">Guarda tu API Key.</p>'; return; }

    let data;
    try {
        data = await chrome.runtime.sendMessage({ action: 'getOrbisExpedienteServicios', apiKey, expedienteId: expId });
    } catch (e) {
        servEl.innerHTML = `<p class="status-text" style="color:#dc3545;">Error: ${_orbisEsc(e.message || e)}</p>`;
        return;
    }
    if (!data || data.status !== 'success') {
        servEl.innerHTML = `<p class="status-text" style="color:#dc3545;">${_orbisEsc((data && data.message) || 'No se pudieron cargar los servicios.')}</p>`;
        return;
    }
    const exp = data.expediente || {};
    const servs = data.servicios || [];
    if (titleEl) {
        const n = (exp.num_id_expediente != null) ? exp.num_id_expediente : (expNum || '');
        const code = exp.str_expediente ? ` (${exp.str_expediente})` : '';
        titleEl.textContent = `Expediente ${n}${code} · ${servs.length} servicio${servs.length === 1 ? '' : 's'} en Orbis`;
    }
    if (!servs.length) {
        servEl.innerHTML = '<p class="status-text">Este expediente no tiene servicios en Orbis.</p>';
        notifySizeChange();
        return;
    }
    servEl.innerHTML = servs.map(_renderOrbisServicioRow).join('');
    notifySizeChange();
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    // --- NUEVA LÓGICA PARA GESTIONAR PESTAÑAS ---
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Si el botón no tiene data-tab, no es una pestaña (ej: botón de abrir ventana)
            const targetPaneId = button.getAttribute('data-tab');
            if (!targetPaneId) {
                return; // No hacer nada si no es una pestaña
            }
            
            // Quitar 'active' de todos los botones y paneles
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));

            // Añadir 'active' al botón clickeado y a su panel correspondiente
            button.classList.add('active');
            const targetPane = document.getElementById(targetPaneId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
            
            // Si se cambia a la pestaña de Captura, aplicar la lógica de visibilidad de desplegables
            if (targetPaneId === 'captureContent') {
                updateServiceTypeVisibility();
            }

            // Al abrir Expedientes, mostrar la lista y cargarla la primera vez.
            if (targetPaneId === 'expedientesContent') {
                backToOrbisExpedientesList();
                if (!orbisExpedientesLoaded) {
                    loadOrbisExpedientes('');
                }
            }

            // Notificar el cambio de tamaño al cambiar de pestaña
            notifySizeChange();
        });
    });
    // --- FIN LÓGICA DE PESTAÑAS ---

    // --- EXPEDIENTES ORBISWEB: wiring de la pestaña ---
    const orbisExpRefreshBtn = document.getElementById('orbisExpRefreshBtn');
    if (orbisExpRefreshBtn) {
        orbisExpRefreshBtn.addEventListener('click', () => {
            const q = (document.getElementById('orbisExpFilterInput') || {}).value || '';
            loadOrbisExpedientes(q.trim());
        });
    }
    const orbisExpBackBtn = document.getElementById('orbisExpBackBtn');
    if (orbisExpBackBtn) {
        orbisExpBackBtn.addEventListener('click', backToOrbisExpedientesList);
    }
    const orbisExpFilterInput = document.getElementById('orbisExpFilterInput');
    if (orbisExpFilterInput) {
        orbisExpFilterInput.addEventListener('input', () => {
            if (orbisExpFilterTimer) clearTimeout(orbisExpFilterTimer);
            orbisExpFilterTimer = setTimeout(() => {
                loadOrbisExpedientes(orbisExpFilterInput.value.trim());
                orbisExpFilterTimer = null;
            }, 400);
        });
    }

    // --- NOTAS: cargar y guardar automáticamente ---
    const NOTES_STORAGE_KEY = 'capdata_notes';
    const notesTextarea = document.getElementById('notesTextarea');
    if (notesTextarea) {
        chrome.storage.local.get(NOTES_STORAGE_KEY, (result) => {
            if (result[NOTES_STORAGE_KEY]) {
                notesTextarea.value = result[NOTES_STORAGE_KEY];
            }
        });
        let notesSaveTimeout = null;
        notesTextarea.addEventListener('input', () => {
            if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
            notesSaveTimeout = setTimeout(() => {
                chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notesTextarea.value });
                notesSaveTimeout = null;
            }, 400);
        });
    }

    const ui = {
        apiKeyInput: document.getElementById('apiKey'),
        saveApiKeyBtn: document.getElementById('saveApiKeyBtn'),
        statusDiv: document.getElementById('statusMessage'),
        mainServiceType: document.getElementById('mainServiceType'),
        // Pestaña Captura
        reservationTypeSelect: document.getElementById('reservationType'),
        capturarReservaBtn: document.getElementById('capturarReserva'),
        clearBtn: document.getElementById('clearBtn'),
        spinner: document.getElementById('spinnerContainer'),
        formContainer: document.getElementById('formContainer'),
        standardFieldsContainer: document.getElementById('standardFieldsContainer'),
        globalActionsRow: document.getElementById('globalActionsRow'),
        // Pestaña Llenado
        contactFilterInput: document.getElementById('contactFilterInput'),
        contactTableContainer: document.getElementById('contactTableContainer'),
        prevContactPageBtn: document.getElementById('prevContactPageBtn'),
        nextContactPageBtn: document.getElementById('nextContactPageBtn'),
        contactPageIndicator: document.getElementById('contactPageIndicator'),
        fillWithContactBtn: document.getElementById('fillWithContactBtn'),
        // Panel de detalles
        contactDetailsPanel: document.getElementById('contactDetailsPanel'),
        contactDetailsTitle: document.getElementById('contactDetailsTitle'),
        contactDetailsContent: document.getElementById('contactDetailsContent'),
        backToContactsBtn: document.getElementById('backToContactsBtn'),
        // analyzeAndFillBtn: document.getElementById('analyzeAndFillBtn')

        saveAllBtn: document.getElementById('saveAllBtn'),
        discardBtn: document.getElementById('discardBtn'),
        // Carpetas
        backToRootBtn: document.getElementById('backToRootBtn'),
        folderNavBar: document.getElementById('folderNavBar'),
        currentFolderNameLabel: document.getElementById('currentFolderName'),
        // Pestaña Notas
        notesTextarea: document.getElementById('notesTextarea'),
    };

    const serviceTypeSelect = document.getElementById('mainServiceType');
    const errorMsg = document.getElementById('serviceTypeError');
    updateGiavContactsVisibility();

    serviceTypeSelect.addEventListener('change', () => {
        if (serviceTypeSelect.value) {
            serviceTypeSelect.style.borderColor = '#0672ff';
            serviceTypeSelect.style.backgroundColor = '#fff';
            errorMsg.style.display = 'none';
        }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[CAPTURE_HIDE_EMPTY_RULES_KEY]) {
            const nextValue = changes[CAPTURE_HIDE_EMPTY_RULES_KEY]?.newValue;
            captureHideWhenEmptyRules = (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) ? nextValue : {};
        }
        if (namespace === 'local' && changes.savedReservationData) {
            const newReservations = changes.savedReservationData?.newValue;
            console.log('[POPUP][STORAGE] savedReservationData actualizado:', {
                totalReservas: Array.isArray(newReservations) ? newReservations.length : 0,
                sampleKeys: (Array.isArray(newReservations) && newReservations[0]) ? Object.keys(newReservations[0]) : []
            });
            if (ui.formContainer.style.display === 'none' || !ui.formContainer.style.display) {
                console.log('[POPUP][STORAGE] Nueva captura detectada, renderizando formulario...');
                initializePopup(ui);
            } else {
                console.log("STORAGE: Cambio detectado por edición manual, ignorando recarga.");
            }
        }
        if (namespace === 'local' && changes[STANDARD_FIELD_VISIBILITY_REFRESH_KEY]) {
            (async () => {
                const { userApiKey } = await chrome.storage.local.get('userApiKey');
                await loadStandardFieldVisibilityForPopup(userApiKey || "");
                const { savedReservationData } = await chrome.storage.local.get('savedReservationData');
                if (typeof buildMultiEditableForm === 'function' && ui && Array.isArray(savedReservationData) && savedReservationData.length > 0) {
                    buildMultiEditableForm(ui, savedReservationData);
                }
            })();
        }
        if (namespace === 'local' && changes[INTEGRATION_FIELD_VISIBILITY_REFRESH_KEY]) {
            (async () => {
                const { userApiKey } = await chrome.storage.local.get('userApiKey');
                await loadIntegrationFieldVisibility(userApiKey || "");
                const { savedReservationData } = await chrome.storage.local.get('savedReservationData');
                if (typeof buildMultiEditableForm === 'function' && ui && Array.isArray(savedReservationData) && savedReservationData.length > 0) {
                    buildMultiEditableForm(ui, savedReservationData);
                }
            })();
        }
    });

    if (ui.backToRootBtn) {
        ui.backToRootBtn.addEventListener('click', () => {
            enterFolder(null, 'Inicio', ui);
        });
    }

    // Botón para volver a la lista de contactos
    if (ui.backToContactsBtn) {
        ui.backToContactsBtn.addEventListener('click', () => {
            hideContactDetails(ui);
        });
    }

    ui.saveApiKeyBtn.addEventListener('click', async () => {
        await saveApiKey(ui);
        await loadWebhookStructurePreferences();
    });

    // Event listener para cerrar el modal de dominio no mapeado
    const closeDomainNotMappedModalBtn = document.getElementById('closeDomainNotMappedModal');
    if (closeDomainNotMappedModalBtn) {
        closeDomainNotMappedModalBtn.addEventListener('click', () => {
            hideDomainNotMappedModal();
        });
    }
    // Cerrar modal al hacer clic fuera de él
    const domainNotMappedModal = document.getElementById('domainNotMappedModal');
    if (domainNotMappedModal) {
        domainNotMappedModal.addEventListener('click', (e) => {
            if (e.target === domainNotMappedModal) {
                hideDomainNotMappedModal();
            }
        });
    }

    // Listeners del modal "Web soportada — lugar incorrecto"
    const closeWrongUrlGuidanceBtn = document.getElementById('closeWrongUrlGuidanceModal');
    if (closeWrongUrlGuidanceBtn) {
        closeWrongUrlGuidanceBtn.addEventListener('click', () => {
            hideWrongUrlGuidanceModal();
        });
    }
    const wrongUrlGuidanceModal = document.getElementById('wrongUrlGuidanceModal');
    if (wrongUrlGuidanceModal) {
        wrongUrlGuidanceModal.addEventListener('click', (e) => {
            if (e.target === wrongUrlGuidanceModal) {
                hideWrongUrlGuidanceModal();
            }
        });
    }

    // Pestaña Captura
    ui.capturarReservaBtn.addEventListener('click', () => captureReservation(ui));
    ui.clearBtn.addEventListener('click', () => clearStateAndForm(ui));
    ui.discardBtn.addEventListener('click', () => clearStateAndForm(ui));
    ui.saveAllBtn.addEventListener('click', () => saveAllNewReservations(ui));
    // Pestaña Llenado
    ui.contactFilterInput.addEventListener('input', () => {
        currentPage = 1;
        renderContactTable(ui);
    });
    ui.prevContactPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderContactTable(ui);
        }
    });
    ui.nextContactPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredContacts.length / CONTACTS_PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            renderContactTable(ui);
        }
    });
    // Delegación de eventos para la selección de contactos
    if (ui.fillWithContactBtn) {
        ui.fillWithContactBtn.addEventListener('click', () => fillFormWithSelectedContact(ui));
    }
    ui.contactTableContainer.addEventListener('click', (e) => {
        // Busca el elemento .contact-row más cercano al punto donde se hizo clic
        const row = e.target.closest('.contact-row');

        // Si no se hizo clic dentro de una fila (ej. en el espacio vacío), no hacemos nada
        if (!row) {
            return;
        }
        // Obtenemos el ID del dataset. Es un string, así que lo convertimos a número para una comparación segura.
        const contactId = parseInt(row.dataset.contactId, 10);
        
        // Validar que contactId sea un número válido
        if (isNaN(contactId)) {
            console.error("contactId no es un número válido:", row.dataset.contactId);
            return;
        }
        
        // Actualizamos la variable de estado global
        selectedContact = allContacts.find(c => c.id === contactId);

        // Si por alguna razón no encontramos el contacto, detenemos para evitar errores
        if (!selectedContact) {
            console.error(`No se encontró el contacto con ID ${contactId} en la lista.`);
            return;
        }
        
        console.log("Contacto seleccionado:", selectedContact);

        // Actualizar la UI:
        // 1. Quitamos la clase 'selected' de cualquier otra fila que la tuviera.
        const allRows = ui.contactTableContainer.querySelectorAll('.contact-row');
        allRows.forEach(r => r.classList.remove('selected'));
        
        // 2. Añadimos la clase 'selected' a la fila en la que se hizo clic.
        row.classList.add('selected');
        
        // 3. Habilitamos el botón de rellenar.
        ui.fillWithContactBtn.disabled = false;
        
        // 4. Mostrar panel de detalles y ocultar otros contactos
        console.log("Llamando a showContactDetails con contactId:", contactId);
        showContactDetails(contactId, ui).catch(error => {
            console.error("Error en showContactDetails:", error);
            showStatus(ui, 'Error al cargar detalles del contacto: ' + error.message, 'error');
        });
        // ***** FIN DE LA CORRECCIÓN *****
    });
    
    // --- ARRANQUE ---
    initializePopup(ui);
    
    // Asegurar que la visibilidad de desplegables se actualice al cargar si la pestaña de Captura está activa
    setTimeout(() => {
        updateServiceTypeVisibility();
        updateGiavContactsVisibility();
    }, 200);
    
    // Notificar cambios de tamaño después de que todo se haya cargado
    setTimeout(notifySizeChange, 100);
    setTimeout(notifySizeChange, 500);
    setTimeout(notifySizeChange, 1000);
    
    // También notificar cuando las imágenes se carguen
    window.addEventListener('load', notifySizeChange); 
});

async function fillFormWithSelectedContact(ui, forceIAAnalysis = false) {
    if (!selectedContact) {
        showStatus(ui, 'Error: Ningún contacto seleccionado.', 'error');
        return;
    }
    const isRetry = forceIAAnalysis;
    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus(ui, 'Error: Se necesita una API Key.', 'error');
        return;
    }

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) throw new Error("No se encontró pestaña activa.");
        const activeTabId = tabs[0].id;

        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: activeTabId, frameIds: [0] },
            func: () => ({ domain: window.location.hostname, html: document.body.outerHTML })
        });

        if (chrome.runtime.lastError || !injectionResults?.[0]?.result) {
            throw new Error("No se pudo obtener el contenido de la página.");
        }
        
        const { domain, html } = injectionResults[0].result;
        
        let selectors = null;
        let usingMappings = false;
        
        if (!isRetry) {
            showStatus(ui, 'Buscando mapeos guardados...', 'info');
            try {
                const mappingsData = await chrome.runtime.sendMessage({
                    action: 'getFieldSelectors',
                    apiKey: apiKey,
                    domain: domain,
                    fieldType: 'autofill'
                });
                
                if (mappingsData.status === 'success' && mappingsData.mappings && Object.keys(mappingsData.mappings).length > 0) {
                    selectors = {};
                    // --- CORRECCIÓN AQUÍ: Manejar string u objeto ---
                    for (const [fieldName, mapping] of Object.entries(mappingsData.mappings)) {
                        if (typeof mapping === 'string') {
                            // Si es un string directo (formato IA)
                            selectors[fieldName] = mapping;
                        } else if (mapping && mapping.selector_path) {
                            // Si es un objeto (formato manual)
                            selectors[fieldName] = mapping.selector_path;
                        }
                    }
                    
                    // Validar si realmente logramos extraer algún selector
                    if (Object.keys(selectors).length > 0) {
                        usingMappings = true;
                        console.log('Usando mapeos encontrados:', selectors);
                    } else {
                        selectors = null; // Forzar paso a IA si el objeto está vacío
                    }
                }
            } catch (error) {
                console.warn('Error cargando mapeos, se usará IA:', error);
            }
        }
        
        // Si no hay selectores válidos tras procesar los mapeos, o es un reintento, ir a IA
        if (!selectors || isRetry) {
            showStatus(ui, 'Analizando formulario con IA...', 'info');
            const response = await chrome.runtime.sendMessage({
                action: 'analyzeForm',
                apiKey: apiKey,
                domain: domain,
                html: html,
                force_analysis: isRetry
            });

            if (response.status !== 'success') {
                throw new Error(response.message || 'La API no pudo obtener los selectores.');
            }
            
            selectors = response.selectors;
            usingMappings = false;
        }

        const dataToFill = {
            nombre_pax: selectedContact.first_name || selectedContact.full_name?.split(' ')[0],
            primer_apellidos_pax: selectedContact.last_name || selectedContact.full_name?.split(' ').slice(1).join(' '),
            num_documento: selectedContact.document_number,
            fecha_cumple_pax: selectedContact.dob,
            telefono_pax: selectedContact.phone,
            email_pax: selectedContact.email,
            genero_pax: selectedContact.gender, 
            direccion_pax: selectedContact.address,
            tratamiento_pax: selectedContact.tratamiento_pax  
        };

        showStatus(ui, usingMappings ? 'Rellenando con mapeos...' : 'Rellenando con IA...', 'success');

        const responseFromContent = await chrome.tabs.sendMessage(activeTabId, {
            action: 'fillPageData',
            data: dataToFill,
            selectors: selectors 
        });
        
        const report = responseFromContent.report;
        
        if (report.fields_found < 1 && !isRetry && !usingMappings) {
            fillFormWithSelectedContact(ui, true); 
        } else if (report.fields_found >= 1) {
            showStatus(ui, `¡Éxito! Se rellenaron ${report.fields_found} campos.`, 'success');
        } else {
            showStatus(ui, 'No se encontró ningún campo para rellenar.', 'error');
        }

    } catch (error) {
        showStatus(ui, `Error: ${error.message}`, 'error');
        console.error("Error en el proceso de rellenado:", error);
    }
}


async function searchContacts(ui) {
    const searchTerm = ui.contactSearchInput.value.trim();
    const apiKey = ui.apiKeyInput.value.trim();

    if (!apiKey) {
        alert("Por favor, guarda tu API Key primero.");
        return;
    }
    if (!searchTerm) {
        ui.contactResults.innerHTML = ''; // Limpiar resultados si la búsqueda está vacía
        return;
    }

    ui.autofillStatus.textContent = 'Buscando...';
    ui.autofillStatus.style.color = '#0056b3';
    ui.contactResults.innerHTML = '<div class="spinner"></div>'; // Muestra un spinner
    notifySizeChange();

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'searchContacts',
            apiKey: apiKey,
            searchTerm: searchTerm
        });

        if (response.status === 'success') {
            ui.autofillStatus.textContent = `Se encontraron ${response.pagination.total} contactos.`;
            displayContacts(ui, response.contacts);
        } else {
            throw new Error(response.message || 'Error desconocido.');
        }
    } catch (error) {
        ui.autofillStatus.textContent = `Error: ${error.message}`;
        ui.autofillStatus.style.color = '#cc0000';
        ui.contactResults.innerHTML = '';
    }
    notifySizeChange();
}



async function initializePopup(ui) {
    // Lógica de inicialización de la Pestaña Captura
    await initializeCaptureTab(ui);

    // Lógica de inicialización de la Pestaña Llenado
    const { userApiKey } = await chrome.storage.local.get('userApiKey');
    if (userApiKey) {
        ui.apiKeyInput.value = userApiKey;
        fetchAndDisplayContacts(ui, userApiKey);
    } else {
        ui.contactTableContainer.innerHTML = '<p class="status-text">Introduce tu API Key para cargar los contactos.</p>';
    }
}

async function fetchAndDisplayContacts(ui, apiKey) {
    ui.contactTableContainer.innerHTML = '<div class="spinner"></div>';
    selectedContact = null;
    ui.fillWithContactBtn.disabled = true;
    notifySizeChange();
    
    // 1. Gestión de la Barra de Navegación
    if (ui.folderNavBar) {
        if (currentFolderId) {
            ui.folderNavBar.style.display = 'flex';
            if (ui.currentFolderNameLabel) ui.currentFolderNameLabel.textContent = `📂 ${currentFolderName}`;
        } else {
            ui.folderNavBar.style.display = 'none';
        }
    }

    try {
        let itemsToDisplay = [];

        // 2. Si estamos en RAÍZ (y página 1), buscar CARPETAS
        // (Opcional: Si quieres ver carpetas en todas las páginas, quita "currentPage === 1")
        if (currentFolderId === null && currentPage === 1) {
            try {
                const folderRes = await chrome.runtime.sendMessage({ 
                    action: 'getFolders', 
                    apiKey,
                    search: ui.contactFilterInput.value 
                });
                
                if (folderRes && folderRes.status === 'success') {
                    // Marcamos que son carpetas
                    const folders = folderRes.folders.map(f => ({ ...f, type: 'folder' }));
                    itemsToDisplay = [...folders];
                }
            } catch (err) {
                console.error("Error fetching folders:", err);
            }
        }

        // 3. Buscar CONTACTOS (Filtrando por carpeta)
        const folderFilter = currentFolderId ? currentFolderId : 'unassigned';
        
        const contactRes = await chrome.runtime.sendMessage({ 
            action: 'searchContacts', 
            apiKey, 
            searchTerm: ui.contactFilterInput.value,
            folderId: folderFilter 
        });

        if (contactRes && contactRes.status === 'success') {
            // Combinar Carpetas + Contactos
            allContacts = [...itemsToDisplay, ...contactRes.contacts];
            renderContactTable(ui);
        } else {
            throw new Error(contactRes.message || "Error al obtener contactos");
        }

    } catch (error) {
        ui.contactTableContainer.innerHTML = `<p class="status-text" style="color: red;">${error.message}</p>`;
        console.error("Error al buscar contactos:", error); 
    }
    notifySizeChange();
}

// NUEVA FUNCIÓN para renderizar la tabla y la paginación
function renderContactTable(ui) {
    const filterText = ui.contactFilterInput.value.toLowerCase();
    
    // Filtrado local (por si acaso el backend no filtró todo)
    filteredContacts = allContacts.filter(item => {
        if (item.type === 'folder') {
            return item.name.toLowerCase().includes(filterText);
        }

        // Construimos el nombre completo para la búsqueda
        const firstName = item.first_name || "";
        const lastName = item.last_name || "";
        const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
        
        // Otros campos de búsqueda
        const email = (item.email || "").toLowerCase();
        const dni = (item.document_number || "").toLowerCase();

        return fullName.includes(filterText) || 
               email.includes(filterText) || 
               dni.includes(filterText);
    });

    ui.contactTableContainer.innerHTML = '';
    
    if (filteredContacts.length === 0) {
        ui.contactTableContainer.innerHTML = '<p class="status-text">Carpeta vacía.</p>';
        renderPagination(ui);
        return;
    }

    // Paginación local
    const startIndex = (currentPage - 1) * CONTACTS_PER_PAGE;
    const paginatedItems = filteredContacts.slice(startIndex, startIndex + CONTACTS_PER_PAGE);

    paginatedItems.forEach(item => {
        const row = document.createElement('div');
        
        // --- RENDERIZADO DE CARPETA ---
        if (item.type === 'folder') {
            row.className = 'contact-row folder-row'; // Clase CSS especial
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 18px;">📁</span>
                    <strong>${item.name}</strong>
                </div>
            `;
            // Al hacer clic, entramos en la carpeta
            row.addEventListener('click', (e) => {
                e.stopPropagation(); // Evitar que seleccione como contacto
                enterFolder(item.id, item.name, ui);
            });
        } 
        // --- RENDERIZADO DE CONTACTO ---
        else {
            row.className = 'contact-row';
            row.dataset.contactId = item.id;

            // Combinamos nombre y apellido limpiando espacios extra
            const firstName = item.first_name || "";
            const lastName = item.last_name || "";
            const fullName = `${firstName} ${lastName}`.trim() || item.name || "Sin Nombre";

            row.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <strong style="color: #333; font-size: 14px;">${fullName}</strong>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <small style="color: #006aff; font-weight: bold; background: #eef4ff; padding: 1px 5px; border-radius: 4px; font-size: 11px;">
                           ${item.document_number || 'S/D'}
                        </small>
                        <small style="color: #777; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">
                            ${item.email || 'Sin email'}
                        </small>
                    </div>
                </div>
            `;
            
            if (selectedContact && selectedContact.id == item.id) {
                row.classList.add('selected');
            }
        }
        ui.contactTableContainer.appendChild(row);
    });

    renderPagination(ui);
}

// NUEVA FUNCIÓN para renderizar solo los controles de paginación
function renderPagination(ui) {
    const totalPages = Math.ceil(filteredContacts.length / CONTACTS_PER_PAGE) || 1;
    ui.contactPageIndicator.textContent = `Página ${currentPage} de ${totalPages}`;
    ui.prevContactPageBtn.disabled = currentPage === 1;
    ui.nextContactPageBtn.disabled = currentPage === totalPages;
}

// Función para obtener icono según el tipo de campo
function getFieldIcon(fieldKey) {
    const iconMap = {
        'name': '👤',
        'first_name': '👤',
        'last_name': '👤',
        'second_last_name': '👤',
        'email': '📧',
        'phone': '📞',
        'document_number': '🆔',
        'address': '📍',
        'dob': '📅',
        'notes': '📝',
        'salutation': '👔',
        'cif': '🏢',
        'legal_name': '🏢',
        'trade_name': '🏢',
        'website': '🌐',
        'cnae_code': '📋'
    };
    return iconMap[fieldKey] || '📄';
}

// Función para obtener label en español
function getFieldLabel(fieldKey) {
    const labelMap = {
        'name': 'Nombre',
        'first_name': 'Nombre',
        'last_name': 'Primer Apellido',
        'second_last_name': 'Segundo Apellido',
        'email': 'Email',
        'phone': 'Teléfono',
        'document_number': 'Nº Documento',
        'address': 'Dirección',
        'dob': 'Fecha de Nacimiento',
        'notes': 'Notas',
        'salutation': 'Saludo/Tratamiento',
        'cif': 'CIF',
        'legal_name': 'Razón Social',
        'trade_name': 'Nombre Comercial',
        'website': 'Página Web',
        'cnae_code': 'Código CNAE'
    };
    return labelMap[fieldKey] || fieldKey;
}

// Función para copiar al portapapeles
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // Fallback para navegadores antiguos
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (e) {
            document.body.removeChild(textArea);
            return false;
        }
    }
}

// Función para renderizar un campo en el panel de detalles
function renderDetailField(fieldKey, fieldValue, container) {
    if (!fieldValue || fieldValue === '') {
        return; // No mostrar campos vacíos
    }
    
    const item = document.createElement('div');
    item.className = 'contact-detail-item';
    
    const icon = document.createElement('span');
    icon.className = 'contact-detail-icon';
    icon.textContent = getFieldIcon(fieldKey);
    
    const label = document.createElement('span');
    label.className = 'contact-detail-label';
    label.textContent = getFieldLabel(fieldKey) + ':';
    
    const value = document.createElement('span');
    value.className = 'contact-detail-value';
    value.textContent = fieldValue;
    
    const copyBtn = document.createElement('button');
    copyBtn.className = 'contact-detail-copy';
    copyBtn.textContent = '📋 Copiar';
    copyBtn.title = 'Copiar al portapapeles';
    copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const success = await copyToClipboard(fieldValue);
        if (success) {
            copyBtn.textContent = '✓ Copiado';
            copyBtn.style.background = '#28a745';
            setTimeout(() => {
                copyBtn.textContent = '📋 Copiar';
                copyBtn.style.background = '#0672ff';
            }, 2000);
        }
    });
    
    item.appendChild(icon);
    item.appendChild(label);
    item.appendChild(value);
    item.appendChild(copyBtn);
    
    container.appendChild(item);
}

// Función para mostrar el panel de detalles del contacto
async function showContactDetails(contactId, ui) {
    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus(ui, 'Error: Se necesita una API Key.', 'error');
        return;
    }

    // Ocultar otros contactos (pero mantener visible el seleccionado)
    const allRows = ui.contactTableContainer.querySelectorAll('.contact-row');
    allRows.forEach(row => {
        const rowContactId = parseInt(row.dataset.contactId, 10);
        if (rowContactId !== contactId) {
            row.classList.add('hidden');
        } else {
            // Asegurar que el contacto seleccionado esté visible y seleccionado
            row.classList.remove('hidden');
            row.classList.add('selected');
        }
    });

    // Ocultar buscador, tabla y paginación cuando se muestra el detalle
    if (ui.contactFilterActionRow) {
        ui.contactFilterActionRow.classList.add('hidden-element');
    }
    if (ui.contactTableContainer) {
        ui.contactTableContainer.classList.add('hidden-element');
    }
    if (ui.contactPagination) {
        ui.contactPagination.classList.add('hidden-element');
    }

    // Conectar visualmente el contenedor con el panel de detalles
    if (ui.contactTableContainer) {
        ui.contactTableContainer.classList.add('has-details');
    }
    
    // Mostrar panel de detalles INMEDIATAMENTE (antes de cargar datos)
    console.log("Mostrando panel de detalles, elemento existe:", !!ui.contactDetailsPanel);
    if (ui.contactDetailsPanel) {
        ui.contactDetailsPanel.style.display = 'block';
        ui.contactDetailsPanel.classList.add('visible');
        if (ui.contactDetailsContent) {
            ui.contactDetailsContent.innerHTML = '<p class="status-text">Cargando datos del contacto...</p>';
        }
        console.log("Panel mostrado, display:", ui.contactDetailsPanel.style.display, "visible class:", ui.contactDetailsPanel.classList.contains('visible'));
    } else {
        console.error("contactDetailsPanel no encontrado en UI");
        throw new Error("Panel de detalles no encontrado en el DOM");
    }
    
    // Forzar re-render para que se vea el panel
    notifySizeChange();

    try {
        // Obtener employee_token si existe
        const { employeeToken } = await chrome.storage.local.get('employeeToken');
        
        // Usar chrome.runtime.sendMessage para ir a través de background.js (igual que list_contacts)
        // Esto asegura que use la misma URL base configurada en background.js
        console.log("Llamando a getContactFullDetails para contactId:", contactId);
        const contactRes = await chrome.runtime.sendMessage({ 
            action: 'getContactFullDetails', 
            apiKey,
            contactId: contactId,
            employeeToken: employeeToken || null
        });

        console.log("Respuesta recibida:", contactRes);

        if (!contactRes || contactRes.status !== 'success') {
            throw new Error(contactRes?.message || 'Error al obtener datos del contacto');
        }

        // Renderizar datos
        renderContactDetails(contactRes.contact, ui);

    } catch (error) {
        console.error('Error al cargar detalles del contacto:', error);
        if (ui.contactDetailsContent) {
            ui.contactDetailsContent.innerHTML = `<p class="status-text" style="color: #dc3545;">Error: ${error.message}</p>`;
        } else {
            showStatus(ui, 'Error al cargar detalles del contacto: ' + error.message, 'error');
        }
    }

    notifySizeChange();
}

// Función para renderizar los detalles del contacto
function renderContactDetails(contactData, ui) {
    if (!ui.contactDetailsContent) {
        console.error("contactDetailsContent no encontrado");
        return;
    }
    const content = ui.contactDetailsContent;
    content.innerHTML = '';

    // Título con nombre del contacto
    const contactName = contactData.base_fields.name || 
                       `${contactData.base_fields.first_name} ${contactData.base_fields.last_name}`.trim() ||
                       'Contacto';
    ui.contactDetailsTitle.textContent = `Datos del Contacto: ${contactName}`;

    // Sección: Campos Base
    const baseSection = document.createElement('div');
    baseSection.className = 'contact-details-section';
    const baseTitle = document.createElement('div');
    baseTitle.className = 'contact-details-section-title';
    baseTitle.textContent = '📋 Datos Personales';
    baseSection.appendChild(baseTitle);
    
    const baseGrid = document.createElement('div');
    baseGrid.className = 'contact-details-grid';
    
    // Renderizar campos base (excluyendo id)
    const baseFields = contactData.base_fields;
    const baseFieldOrder = ['name', 'first_name', 'last_name', 'second_last_name', 'salutation', 
                           'email', 'phone', 'document_number', 'address', 'dob', 'notes'];
    
    baseFieldOrder.forEach(key => {
        if (baseFields[key]) {
            renderDetailField(key, baseFields[key], baseGrid);
        }
    });
    
    // Si no hay first_name/last_name pero sí name, mostrar name
    if (!baseFields.first_name && !baseFields.last_name && baseFields.name) {
        renderDetailField('name', baseFields.name, baseGrid);
    }
    
    baseSection.appendChild(baseGrid);
    content.appendChild(baseSection);

    // Sección: Campos Personalizados
    if (contactData.custom_fields && Object.keys(contactData.custom_fields).length > 0) {
        const customSection = document.createElement('div');
        customSection.className = 'contact-details-section';
        const customTitle = document.createElement('div');
        customTitle.className = 'contact-details-section-title';
        customTitle.textContent = '📄 Campos Personalizados';
        customSection.appendChild(customTitle);
        
        const customGrid = document.createElement('div');
        customGrid.className = 'contact-details-grid';
        
        Object.entries(contactData.custom_fields).forEach(([key, value]) => {
            if (value) {
                renderDetailField(key, value, customGrid);
            }
        });
        
        customSection.appendChild(customGrid);
        content.appendChild(customSection);
    }

    // Sección: Datos de Empresa (si existe)
    if (contactData.company) {
        const companySection = document.createElement('div');
        companySection.className = 'contact-details-section';
        const companyTitle = document.createElement('div');
        companyTitle.className = 'contact-details-section-title';
        companyTitle.textContent = '🏢 Datos de la Empresa';
        companySection.appendChild(companyTitle);
        
        const companyGrid = document.createElement('div');
        companyGrid.className = 'contact-details-grid';
        
        // Campos base de la empresa
        const companyBaseFields = contactData.company.base_fields || {};
        const companyFieldOrder = ['name', 'cif', 'legal_name', 'trade_name', 'email', 'phone', 
                                  'address', 'document_number', 'website', 'cnae_code'];
        
        companyFieldOrder.forEach(key => {
            if (companyBaseFields[key]) {
                renderDetailField(key, companyBaseFields[key], companyGrid);
            }
        });
        
        // Campos personalizados de la empresa
        if (contactData.company.custom_fields) {
            Object.entries(contactData.company.custom_fields).forEach(([key, value]) => {
                if (value) {
                    renderDetailField(key, value, companyGrid);
                }
            });
        }
        
        companySection.appendChild(companyGrid);
        content.appendChild(companySection);
    }

    notifySizeChange();
}

// Función para ocultar el panel de detalles y volver a la lista
function hideContactDetails(ui) {
    // Ocultar panel de detalles
    if (ui.contactDetailsPanel) {
        ui.contactDetailsPanel.classList.remove('visible');
        ui.contactDetailsPanel.style.display = 'none';
    }
    
    // Restaurar el estilo del contenedor de contactos
    if (ui.contactTableContainer) {
        ui.contactTableContainer.classList.remove('has-details');
        ui.contactTableContainer.classList.remove('hidden-element');
    }
    
    // Mostrar buscador y paginación de nuevo
    if (ui.contactFilterActionRow) {
        ui.contactFilterActionRow.classList.remove('hidden-element');
    }
    if (ui.contactPagination) {
        ui.contactPagination.classList.remove('hidden-element');
    }
    
    // Mostrar todos los contactos de nuevo
    if (ui.contactTableContainer) {
        const allRows = ui.contactTableContainer.querySelectorAll('.contact-row');
        allRows.forEach(row => {
            row.classList.remove('hidden');
            row.classList.remove('selected');
        });
    }
    
    // Limpiar selección
    selectedContact = null;
    if (ui.fillWithContactBtn) {
        ui.fillWithContactBtn.disabled = true;
    }
    
    // Mostrar filtro y paginación
    if (ui.contactFilterActionRow) {
        ui.contactFilterActionRow.style.display = 'flex';
    }
    if (ui.contactPagination) {
        ui.contactPagination.style.display = 'flex';
    }
    
    notifySizeChange();
}

async function saveApiKey(ui) {
    const userApiKey = ui.apiKeyInput.value.trim();
    if (userApiKey) {
        await chrome.storage.local.set({ userApiKey });
        alert('API Key guardada.');
        await initializePopup(ui);
    }
}

let ALL_SERVICE_FIELDS = {}; 

// Función para actualizar la visibilidad de los desplegables según las integraciones activas
function updateServiceTypeVisibility() {
    const reservationTypeContainer = document.getElementById('reservationTypeContainer');
    const serviceTypeSelectionContainer = document.getElementById('serviceTypeSelectionContainer');
    const mainServiceType = document.getElementById('mainServiceType');
    
    // SIEMPRE mostrar el desplegable genérico y ocultar el de Gesintur
    // El desplegable genérico solo tiene "Aéreo" como opción
    if (reservationTypeContainer) {
        reservationTypeContainer.style.display = 'none';
    }
    if (serviceTypeSelectionContainer) {
        serviceTypeSelectionContainer.style.display = 'block';
    }
    // Establecer valor por defecto "aereo" en el desplegable genérico
    if (mainServiceType) {
        mainServiceType.value = 'aereo';
    }
}

async function initializeCaptureTab(ui) {
    showSpinner(ui, true);
    
    try {
        await loadCaptureHideWhenEmptyRules();
        await syncCurrentCaptureDomainFromActiveTab();
        // 1. OBTENER API KEY PARA IDENTIFICAR CAMPOS PERSONALIZADOS
        const { userApiKey } = await chrome.storage.local.get('userApiKey');
        
        // 2. SOLICITAR DEFINICIONES UNIFICADAS AL BACKEND
        const fieldsDef = await chrome.runtime.sendMessage({ 
            action: 'getFieldsDefinition',
            apiKey: userApiKey || "" // Enviamos la key para recibir los custom fields
        });

        if (!fieldsDef || fieldsDef.status !== 'success') throw new Error(fieldsDef.message || "Respuesta inválida.");
        
        // 3. MAPEO DE METADATOS GLOBALES (Para etiquetas, tipos y visibilidad)
        window.FIELD_SCHEMA_MAP = {};
        
        // Procesar esquema estándar
        if (fieldsDef.schema && Array.isArray(fieldsDef.schema)) {
            fieldsDef.schema.forEach(f => {
                window.FIELD_SCHEMA_MAP[f.slug] = f;
            });
        }
        
        // Procesar esquema personalizado (CUSTOM)
        window.CUSTOM_SCHEMA = fieldsDef.custom_schema || [];
        window.CUSTOM_SCHEMA.forEach(f => {
            window.FIELD_SCHEMA_MAP[f.slug] = f; 
        });

        // 4. CARGA DE SLUGS POR CATEGORÍA
        STANDARD_FIELDS = fieldsDef.standard_fields || [];
        
        // Gestión de Mapa de Servicios (Aereo, Hotel, etc.)
        if (fieldsDef.service_fields && typeof fieldsDef.service_fields === 'object') {
            ALL_SERVICE_FIELDS = fieldsDef.service_fields;
        } else {
            console.warn("SERVICE_FIELDS no recibido, usando STANDARD_FIELDS como respaldo.");
            ALL_SERVICE_FIELDS = {
                "aereo": STANDARD_FIELDS,
                "hotel": STANDARD_FIELDS,
                "rent_a_car": STANDARD_FIELDS,
                "tren": STANDARD_FIELDS
            };
        }

        // Referencias globales para el script
        window.STANDARD_FIELDS = STANDARD_FIELDS;
        window.ALL_SERVICE_FIELDS = ALL_SERVICE_FIELDS;
        
        // Definiciones específicas para integraciones ERP
        AVSIS_SPECIFIC_FIELDS = fieldsDef.avsis_fields || [];
        GESINTUR_BILETE_FIELDS = fieldsDef.gesintur_billete_fields || [];
        GESINTUR_NORMAL_FIELDS = fieldsDef.gesintur_normal_fields || [];
        PIPELINE_ORBISWEB_FIELDS = fieldsDef.pipeline_orbisweb_fields || [];

        // Visibilidad de campos genéricos (solo UI; NO afecta payload enviado)
        cachedStandardFieldVisibility = {};
        const stdVisibility = (fieldsDef.standard_field_visibility && typeof fieldsDef.standard_field_visibility === 'object')
            ? fieldsDef.standard_field_visibility
            : {};
        Object.entries(stdVisibility).forEach(([k, v]) => {
            const key = String(k || '').trim().toLowerCase();
            if (!key) return;
            cachedStandardFieldVisibility[key] = (v === 0 || v === false || v === '0') ? 0 : 1;
        });
        // Forzar la fuente canónica desde endpoint dedicado (evita cachés antiguos en get-fields-definition).
        await loadStandardFieldVisibilityForPopup(userApiKey || "");

    } catch (error) {
        console.error("Error inicializando definiciones de captura:", error);
        showStatus(ui, 'Error: No se pudo cargar la configuración de captura.', 'error');
        showSpinner(ui, false);
        return;
    }

    // 5. CARGAR ÚLTIMA RESERVA DESDE EL STORAGE
    const initStorage = await chrome.storage.local.get(['savedReservationData', CAPTURE_VIEW_STATE_KEY]);
    const savedReservationData = initStorage.savedReservationData;
    const captureViewState = initStorage[CAPTURE_VIEW_STATE_KEY];
    isLastCaptureSavedLocked = !!(captureViewState && captureViewState.mode === 'saved_locked');
    if (!savedReservationData && isLastCaptureSavedLocked) {
        isLastCaptureSavedLocked = false;
        await chrome.storage.local.remove(CAPTURE_VIEW_STATE_KEY);
    }
    
    if (savedReservationData) {
        // Restablecer el tipo de reserva desde los datos guardados
        const reservationType = savedReservationData[0]?.reservation_type;
        if (reservationType) {
            // Si es un tipo de Gesintur (billetaje o aereo cuando gesintur está activo)
            if (cachedGesinturStatus && (reservationType === 'billetaje' || reservationType === 'aereo')) {
                selectedReservationType = reservationType;
                ui.reservationTypeSelect.value = reservationType;
            }
            // Si es un tipo de ORBISWEB o genérico
            else {
                ui.mainServiceType.value = reservationType.replace("_oneway", ""); 
            }
        }
        
        const { userApiKey } = await chrome.storage.local.get('userApiKey');
        if (userApiKey) {
            // Verificamos el estado de todas las integraciones
            const avsisResult = await checkAvsisStatus(userApiKey);
            cachedAvsisStatus = avsisResult.active;
            
            const gesinturResult = await checkGesinturStatus(userApiKey);
            cachedGesinturStatus = gesinturResult.active;
            
            const orbiswebResult = await checkOrbiswebStatus(userApiKey);
            cachedOrbiswebStatus = orbiswebResult.active;
            applyOrbisExpedientesTabVisibility();

            await loadIntegrationVisibility(userApiKey);
            await loadIntegrationFieldVisibility(userApiKey);
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            updateGiavContactsVisibility();
            
            // Mostrar selector de tipo ORBISWEB solo si orbisweb está activo
            const orbiswebTypeContainer = document.getElementById('orbiswebTypeContainer');
            if (orbiswebTypeContainer) {
                orbiswebTypeContainer.style.display = 'none';
            }
            
            // Preparar mensajes de estado
            const messages = [isLastCaptureSavedLocked ? 'Mostrando última reserva guardada.' : 'Mostrando última reserva capturada.'];
            const hasActiveIntegrations = avsisResult.active || gesinturResult.active || orbiswebResult.active;
            
            if (avsisResult.message) messages.push(avsisResult.message);
            if (gesinturResult.message) messages.push(gesinturResult.message);
            if (orbiswebResult.message) messages.push(orbiswebResult.message);
            
            showStatus(ui, messages.join(' '), hasActiveIntegrations ? 'success' : 'info');
        } else {
            showStatus(ui, isLastCaptureSavedLocked ? 'Mostrando última reserva guardada.' : 'Mostrando última reserva capturada.', 'info');
        }

        // --- DIBUJAR FORMULARIO (Ahora usará ALL_SERVICE_FIELDS y CUSTOM_SCHEMA internamente) ---
        buildMultiEditableForm(ui, savedReservationData);
        ui.formContainer.style.display = 'block';
        ui.globalActionsRow.style.display = 'flex';

    } else {
        // --- CASO: NO HAY DATOS GUARDADOS (FLUJO INICIAL) ---
        const { userApiKey } = await chrome.storage.local.get('userApiKey');
        if (userApiKey) {
            const avsisResult = await checkAvsisStatus(userApiKey);
            cachedAvsisStatus = avsisResult.active;
            
            const gesinturResult = await checkGesinturStatus(userApiKey);
            cachedGesinturStatus = gesinturResult.active;
            
            const orbiswebResult = await checkOrbiswebStatus(userApiKey);
            cachedOrbiswebStatus = orbiswebResult.active;
            applyOrbisExpedientesTabVisibility();

            await loadIntegrationVisibility(userApiKey);
            await loadIntegrationFieldVisibility(userApiKey);
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            updateGiavContactsVisibility();
            
            const orbiswebTypeContainer = document.getElementById('orbiswebTypeContainer');
            if (orbiswebTypeContainer) {
                orbiswebTypeContainer.style.display = cachedOrbiswebStatus ? 'block' : 'none';
            }
            
            const messages = [];
            if (avsisResult.message) messages.push(avsisResult.message);
            if (gesinturResult.message) messages.push(gesinturResult.message);
            if (orbiswebResult.message) messages.push(orbiswebResult.message);
            
            if (messages.length > 0) {
                showStatus(ui, messages.join(' '), 'success');
            } else {
                showStatus(ui, '', 'info');
            }
        } else {
            showStatus(ui, 'Por favor, guarda tu API Key.', 'info');
            updateGiavContactsVisibility();
        }
    }
    updateGiavContactsVisibility();
    showSpinner(ui, false);
}

async function checkAvsisStatus(apiKey) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkAvsisIntegration', apiKey });
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);

        const integrations = extractIntegrationsFromResponse(response);
        if (integrations) {
            const isActive = hasActiveIntegration(integrations, ['avsis']);
            const message = isActive ? '✅ Integración AVSIS ACTIVA.' : '';
            return { active: isActive, message: message };
        }
        return { active: false, message: `⚠️ ${response.message || 'Respuesta inesperada.'}` };
    } catch (error) {
        return { active: false, message: `🚨 Error de conexión: ${error.message}` };
    }
}

async function checkGesinturStatus(apiKey) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkGesinturIntegration', apiKey });
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);

        const integrations = extractIntegrationsFromResponse(response);
        if (integrations) {
            const isActive = hasActiveIntegration(integrations, ['gesintur']);
            const message = isActive ? '✅ Integración Gesintur ACTIVA.' : '';
            return { active: isActive, message: message };
        }
        return { active: false, message: `⚠️ ${response.message || 'Respuesta inesperada.'}` };
    } catch (error) {
        return { active: false, message: `🚨 Error de conexión: ${error.message}` };
    }
}

async function checkOrbiswebStatus(apiKey) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkOrbiswebIntegration', apiKey });
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);

        const integrations = extractIntegrationsFromResponse(response);
        if (integrations) {
            const isActive = hasActiveIntegration(integrations, ['orbisweb', 'orbis_web', 'orbis-web']);
            const message = isActive ? '✅ Integración Pipeline/ORBISWEB ACTIVA.' : '';
            return { active: isActive, message: message };
        }
        return { active: false, message: `⚠️ ${response.message || 'Respuesta inesperada.'}` };
    } catch (error) {
        return { active: false, message: `🚨 Error de conexión: ${error.message}` };
    }
}

function extractIntegrationsFromResponse(response) {
    if (!response || typeof response !== 'object') return null;
    if (Array.isArray(response.integrations)) return response.integrations;
    if (Array.isArray(response.data?.integrations)) return response.data.integrations;
    if (Array.isArray(response.result?.integrations)) return response.result.integrations;
    return null;
}

function hasActiveIntegration(integrations, acceptedSlugs) {
    if (!Array.isArray(integrations) || !Array.isArray(acceptedSlugs)) return false;
    const normalizedAccepted = acceptedSlugs.map(s => String(s || '').toLowerCase());
    return integrations.some((integration) => {
        if (!integration || typeof integration !== 'object') return false;
        const slug = String(integration.slug || '').toLowerCase();
        const isAccepted = normalizedAccepted.some(candidate => slug === candidate || slug.includes(candidate));
        if (!isAccepted) return false;
        return integration.active === true;
    });
}

async function loadIntegrationVisibility(apiKey) {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getIntegrationVisibility', apiKey });
        if (res && res.status === 'ok' && res.visibility) {
            cachedIntegrationVisibility = res.visibility;
        }
    } catch (_) {
        cachedIntegrationVisibility = { avsis: true, gesintur: true, orbisweb: true };
    }
}

async function loadIntegrationFieldVisibility(apiKey) {
    try {
        const res = await chrome.runtime.sendMessage({ action: 'getIntegrationFieldVisibility', apiKey });
        if (res && typeof res === 'object' && res.field_visibility && typeof res.field_visibility === 'object') {
            ['avsis', 'orbisweb', 'gesintur'].forEach(slug => {
                const fv = res.field_visibility[slug];
                if (fv && typeof fv === 'object') {
                    cachedIntegrationFieldVisibility[slug] = { ...fv };
                }
            });
        }
    } catch (_) {
        cachedIntegrationFieldVisibility = { avsis: {}, orbisweb: {}, gesintur: {} };
    }
}

/** true si el campo de la integración debe mostrarse y enviarse (por defecto visible si no hay registro) */
function isIntegrationFieldVisible(slug, fieldName) {
    const vis = cachedIntegrationFieldVisibility[slug];
    if (!vis || typeof vis !== 'object') return true;
    if (fieldName in vis) return vis[fieldName] !== 0;
    if (slug === 'gesintur') {
        const aliases = getGesinturFieldAliases(fieldName);
        const aliasHit = aliases.find((alias) => alias in vis);
        if (aliasHit) return vis[aliasHit] !== 0;
    }
    return true;
}

function normalizeCaptureScopeDomain(domain) {
    return String(domain || '').trim().toLowerCase().replace(/^www\./i, '');
}

function normalizeCaptureScopeService(serviceType) {
    return String(serviceType || 'aereo').trim().toLowerCase();
}

async function loadCaptureHideWhenEmptyRules() {
    try {
        const result = await chrome.storage.local.get(CAPTURE_HIDE_EMPTY_RULES_KEY);
        const raw = result?.[CAPTURE_HIDE_EMPTY_RULES_KEY];
        captureHideWhenEmptyRules = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } catch (_) {
        captureHideWhenEmptyRules = {};
    }
}

function getCaptureScopeKey(serviceTypeOverride = null) {
    const domain = normalizeCaptureScopeDomain(currentCaptureDomain);
    if (!domain) return '';
    const serviceType = normalizeCaptureScopeService(serviceTypeOverride || selectedReservationType || document.getElementById('mainServiceType')?.value || 'aereo');
    return `${serviceType}::${domain}`;
}

function isConfiguredToHideWhenEmpty(fieldName, serviceTypeOverride = null) {
    const scopeKey = getCaptureScopeKey(serviceTypeOverride);
    if (!scopeKey) return false;
    const scopeRules = captureHideWhenEmptyRules[scopeKey];
    return !!(scopeRules && scopeRules[fieldName] === true);
}

function isEmptyCapturedValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

async function syncCurrentCaptureDomainFromActiveTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const rawUrl = tabs?.[0]?.url || '';
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return;
        const url = new URL(rawUrl);
        currentCaptureDomain = normalizeCaptureScopeDomain(url.hostname);
    } catch (_) {
        // Si falla, seguimos con valor previo.
    }
}

// Función para verificar si un dominio tiene mapeos
// Endpoint base centralizado (también para la guía URL)
const POPUP_API_BASE_URL = 'https://capdata.es';
// const POPUP_API_BASE_URL = 'https://testdev.capdata.es';
// const POPUP_API_BASE_URL = 'https://toni-testdev.capdata.es';
// const POPUP_API_BASE_URL = 'http://127.0.0.1:5000';

// Lista de service_types a sondear para detectar URLs mapeadas en el dominio.
// Incluimos también '' para cubrir filas legacy con service_type vacío.
function buildGuidanceServiceTypeCandidates(reservationType) {
    const base = String(reservationType || '').split('_')[0];
    const list = [
        '',
        reservationType,
        `${reservationType}_oneway`,
        base,
        `${base}_oneway`,
        'aereo',
        'aereo_oneway',
        'billetaje',
        'hotel',
        'rent_a_car',
        'tren',
        'tren_oneway'
    ];
    return [...new Set(list.map(s => String(s ?? '').trim()))];
}

// Devuelve info agregada de scopes URL del dominio (independiente de campos mapeados).
async function fetchDomainUrlGuidance(domain, currentUrl, apiKey, reservationType) {
    const serviceTypes = buildGuidanceServiceTypeCandidates(reservationType);
    const aggregated = {
        hasUrlScopes: false,
        scopes: [],
        guidance: null,
        matchedScopeValue: null,
        currentUrlIsMapped: false
    };
    const seenScopes = new Set();
    try {
        const responses = await Promise.all(serviceTypes.map(async (serviceType) => {
            try {
                const url = new URL(`${POPUP_API_BASE_URL}/api/field-selectors/url-guidance`);
                url.searchParams.append('domain', domain);
                url.searchParams.append('current_url', currentUrl || '');
                url.searchParams.append('field_type', 'capture');
                url.searchParams.append('service_type', serviceType);
                const res = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } });
                const data = await res.json();
                if (data?.status !== 'success') return null;
                return data;
            } catch (_) {
                return null;
            }
        }));
        responses.filter(Boolean).forEach((data) => {
            const info = data?.url_scope_info || {};
            const guidance = data?.guidance || info.guidance_for_current_or_fallback || null;
            if (info.has_url_scopes) aggregated.hasUrlScopes = true;
            if (info.matched_meta_scope_value) {
                aggregated.matchedScopeValue = info.matched_meta_scope_value;
                aggregated.currentUrlIsMapped = true;
            }
            if (!aggregated.guidance && guidance) aggregated.guidance = guidance;
            (Array.isArray(info.scopes) ? info.scopes : []).forEach((scope) => {
                const value = String(scope?.scope_value || '').trim();
                if (!value || seenScopes.has(value)) return;
                seenScopes.add(value);
                aggregated.scopes.push(scope);
            });
        });
    } catch (e) {
        console.warn('[POPUP] Error obteniendo guía URL del dominio:', e);
    }
    return aggregated;
}

function mergeGuidanceData(baseGuidance, selectorResponses) {
    const merged = {
        hasUrlScopes: !!baseGuidance?.hasUrlScopes,
        scopes: Array.isArray(baseGuidance?.scopes) ? [...baseGuidance.scopes] : [],
        guidance: baseGuidance?.guidance || null,
        matchedScopeValue: baseGuidance?.matchedScopeValue || null,
        currentUrlIsMapped: !!baseGuidance?.currentUrlIsMapped
    };
    const seen = new Set(merged.scopes.map((s) => String(s?.scope_value || '').trim()).filter(Boolean));
    (selectorResponses || []).forEach((data) => {
        const info = data?.url_scope_info || {};
        if (info.has_url_scopes) merged.hasUrlScopes = true;
        if (String(data?.matched_scope || '').toLowerCase() === 'url') {
            merged.currentUrlIsMapped = true;
        }
        const matchedValue = String(data?.matched_scope_value || info?.matched_meta_scope_value || '').trim();
        if (!merged.matchedScopeValue && matchedValue) {
            merged.matchedScopeValue = matchedValue;
        }
        if (!merged.guidance) {
            merged.guidance = data?.matched_scope_guidance || info?.guidance_for_current_or_fallback || null;
        }
        (Array.isArray(info.scopes) ? info.scopes : []).forEach((scope) => {
            const value = String(scope?.scope_value || '').trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            merged.scopes.push(scope);
        });
    });
    return merged;
}

async function checkDomainMappings(domain, currentUrl, apiKey, reservationType) {
    const API_BASE_URL = POPUP_API_BASE_URL;
    const MIN_REQUIRED_MAPPED_FIELDS = 5;

    const typeNormal = reservationType;
    const typeOneWay = `${reservationType}_oneway`;
    const strictUrl = encodeURIComponent(currentUrl || '');
    const guidancePromise = fetchDomainUrlGuidance(domain, currentUrl, apiKey, reservationType);

    try {
        const [resNormal, resOneWay] = await Promise.all([
            fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&scope_type=url&current_url=${strictUrl}&strict_scope=1&field_type=capture&service_type=${encodeURIComponent(typeNormal)}`, { 
                headers: { "X-API-Key": apiKey }
            }),
            fetch(`${API_BASE_URL}/api/field-selectors?domain=${encodeURIComponent(domain)}&scope_type=url&current_url=${strictUrl}&strict_scope=1&field_type=capture&service_type=${encodeURIComponent(typeOneWay)}`, { 
                headers: { "X-API-Key": apiKey }
            })
        ]);

        const dataNormal = await resNormal.json();
        const dataOneWay = await resOneWay.json();

        let mappingsNormal = {};
        let mappingsOneWay = {};

        if (dataNormal.status === 'success' && dataNormal.mappings) {
            mappingsNormal = dataNormal.mappings;
        }
        if (dataOneWay.status === 'success' && dataOneWay.mappings) {
            mappingsOneWay = dataOneWay.mappings;
        }

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
        const urlGuidanceFromEndpoint = await guidancePromise;
        const urlGuidance = mergeGuidanceData(urlGuidanceFromEndpoint, [dataNormal, dataOneWay]);
        if (mappedFieldNames.size < MIN_REQUIRED_MAPPED_FIELDS) {
            return { hasMappings: false, error: null, urlGuidance };
        }
        const selectors = [...new Set(eligibleMappings.map((m) => m.selector))];
        if (selectors.length === 0) {
            return { hasMappings: false, error: null, urlGuidance };
        }

        const tabs = await new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
        const activeTabId = tabs?.[0]?.id;
        if (!activeTabId) {
            return { hasMappings: false, error: 'No se pudo obtener la pestaña activa para validar selectores.', urlGuidance };
        }
        const injection = await chrome.scripting.executeScript({
            target: { tabId: activeTabId, frameIds: [0] },
            func: (selectorList) => {
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
                for (const selector of selectorList) {
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
            args: [selectors]
        });
        const hasAnySelectorInDom = !!injection?.[0]?.result;
        const hasMappings = hasAnySelectorInDom;

        return { hasMappings, error: null, urlGuidance };
    } catch (error) {
        console.error('Error verificando mapeos del dominio:', error);
        const urlGuidance = await guidancePromise.catch(() => null);
        return { hasMappings: false, error: error.message, urlGuidance };
    }
}

// Decide si toca mostrar el aviso "lugar incorrecto" en lugar del genérico.
function shouldShowWrongUrlGuidance(urlGuidance) {
    if (!urlGuidance) return false;
    const hasScopes = !!urlGuidance.hasUrlScopes || (Array.isArray(urlGuidance.scopes) && urlGuidance.scopes.length > 0);
    if (!hasScopes) return false;
    if (urlGuidance.currentUrlIsMapped) return false;
    return true;
}

function showDomainNotMappedModal(domain) {
    const modal = document.getElementById('domainNotMappedModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function hideDomainNotMappedModal() {
    const modal = document.getElementById('domainNotMappedModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showWrongUrlGuidanceModal(urlGuidance) {
    const modal = document.getElementById('wrongUrlGuidanceModal');
    if (!modal) return;

    const messageEl = document.getElementById('wrongUrlGuidanceMessage');
    const scopesWrap = document.getElementById('wrongUrlGuidanceScopesWrap');
    const scopesEl = document.getElementById('wrongUrlGuidanceScopes');
    const imgEl = document.getElementById('wrongUrlGuidanceImage');

    const guidance = urlGuidance?.guidance || null;
    const customText = (guidance?.instruction_text || '').trim();
    const defaultMsg = 'Esta web está soportada para captura, pero estás en un lugar incorrecto. Realiza la captura desde una de las siguientes URLs :';

    if (messageEl) {
        messageEl.textContent = customText || defaultMsg;
    }

    const scopeValues = Array.isArray(urlGuidance?.scopes)
        ? urlGuidance.scopes.map(s => String(s?.scope_value || '').trim()).filter(Boolean)
        : [];
    if (scopesEl) scopesEl.innerHTML = '';
    if (scopeValues.length > 0 && scopesEl && scopesWrap) {
        scopeValues.slice(0, 5).forEach((value) => {
            const li = document.createElement('li');
            li.textContent = value;
            scopesEl.appendChild(li);
        });
        scopesWrap.style.display = 'block';
    } else if (scopesWrap) {
        scopesWrap.style.display = customText ? 'none' : 'block';
        if (!customText && scopesEl) {
            const li = document.createElement('li');
            li.textContent = 'Una URL mapeada de este dominio.';
            scopesEl.appendChild(li);
        }
    }

    if (imgEl) {
        const imageUrl = (guidance?.instruction_image_url || '').trim();
        if (imageUrl) {
            imgEl.src = imageUrl;
            imgEl.style.display = 'block';
        } else {
            imgEl.removeAttribute('src');
            imgEl.style.display = 'none';
        }
    }

    modal.style.display = 'flex';
}

function hideWrongUrlGuidanceModal() {
    const modal = document.getElementById('wrongUrlGuidanceModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function captureReservation(ui) {
    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        alert("Por favor, ingresa tu API Key.");
        return;
    }

    // Variable para almacenar el tipo seleccionado
    let reservationType = '';

    // SIEMPRE usar el desplegable genérico (Tipo de Servicio) que solo tiene "Aéreo"
    const mainServiceTypeSelect = document.getElementById('mainServiceType');
    if (mainServiceTypeSelect) {
        reservationType = mainServiceTypeSelect.value.trim();
    }

    // Si no hay valor seleccionado, usar "aereo" por defecto (ya que es la única opción disponible)
    if (!reservationType) {
        reservationType = 'aereo';
        if (mainServiceTypeSelect) {
            mainServiceTypeSelect.value = 'aereo';
        }
    }

    // --- VERIFICACIÓN DE MAPEOS ANTES DE CAPTURAR ---
    try {
        // Obtener el dominio de la pestaña activa
        const tabs = await new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });

        if (!tabs || !tabs[0] || !tabs[0].url) {
            showStatus(ui, 'Error: No se pudo obtener la información de la pestaña activa.', 'error');
            return;
        }

        const tabUrl = new URL(tabs[0].url);
        const domain = tabUrl.hostname;
        currentCaptureDomain = normalizeCaptureScopeDomain(domain);

        // Verificar si el dominio tiene mapeos
        showStatus(ui, 'Comprobando validación del dominio...', 'info');
        const mappingCheck = await checkDomainMappings(domain, tabUrl.href, apiKey, reservationType);

        if (!mappingCheck.hasMappings) {
            // Si el dominio tiene URLs mapeadas pero la actual no coincide,
            // mostramos el aviso configurado por el usuario mapeador.
            if (shouldShowWrongUrlGuidance(mappingCheck.urlGuidance)) {
                showWrongUrlGuidanceModal(mappingCheck.urlGuidance);
            } else {
                showDomainNotMappedModal(domain);
            }
            showStatus(ui, '', 'info'); // Limpiar mensaje de estado
            return; // No continuar con la captura
        }

        // Si hay mapeos o hubo un error en la verificación, continuar con el proceso normal
    } catch (error) {
        console.error('Error al verificar mapeos:', error);
        // En caso de error, continuar con el proceso (por si hay problemas de red)
        // El background.js también verificará los mapeos
    }

    // --- PROCESO DE CAPTURA ---

    // 2. Mostrar spinner y bloquear botones para evitar duplicados
    showSpinner(ui, true);

    // 3. Limpiar el estado previo (Storage local y DOM del formulario)
    await clearStateAndForm(ui, false);

    // 4. Mostrar mensaje informativo de inicio
    showStatus(ui, `Iniciando captura de ${reservationType.toUpperCase()}...`, 'info');

    // 5. Enviar mensaje al background.js para ejecutar el proceso de extracción cascada (Niveles 1, 2 y 3)
    chrome.runtime.sendMessage(
        { 
            action: 'startCaptureProcess', 
            apiKey: apiKey, 
            reservationType: reservationType // Pasamos el tipo (aereo, hotel, rent_a_car, tren)
        },
        (response) => {
            // Manejamos posibles errores inmediatos al intentar contactar con el background
            if (chrome.runtime.lastError || response?.status === 'error') {
                const errorMessage = chrome.runtime.lastError?.message || response?.message || 'Error desconocido al iniciar.';
                console.error("Error al iniciar la captura:", errorMessage);
                showStatus(ui, `Error al iniciar: ${errorMessage}`, 'error');
                showSpinner(ui, false);
            } else {
                console.log(`BACKGROUND: Proceso de captura iniciado para [${reservationType}]`);
                // Nota: El spinner permanecerá activo hasta que el proceso en background termine 
                // y actualice el storage local, lo cual disparará la reconstrucción de la UI vía chrome.storage.onChanged
            }
        }
    );
}

async function clearStateAndForm(ui, showInitialMessage = true) {
    await chrome.storage.local.remove(['savedReservationData', CAPTURE_VIEW_STATE_KEY]);
    isLastCaptureSavedLocked = false;
    clearFormDOM(ui);
    // Al limpiar ocultamos también el recuadro de progreso del guardado: ya no
    // tiene sentido seguir mostrándolo si se ha limpiado la captura.
    hideSaveProgressPanel();
    ui.capturarReservaBtn.style.display = 'block';
    ui.globalActionsRow.style.display = 'none';

    if (showInitialMessage) {
        await initializePopup(ui);
    }
}

async function updateSingleReservation(ui, index) {
    const apiKey = ui.apiKeyInput.value.trim();
    
    // Validar campos requeridos de orbisweb antes de guardar
    if (cachedOrbiswebStatus) {
        const validationError = validateOrbiswebRequiredFieldForIndex(index);
        if (validationError) {
            showStatus(ui, validationError, 'error');
            return;
        }
    }
    
    const flightData = await collectSingleFieldData(index); // Recolecta datos del form

    showSpinner(ui, true);
    showStatus(ui, `Actualizando Reserva ${index + 1}...`, 'info');

    try {
        // Llama a la acción 'updateReservation' que ya tenías (SIN COSTE)
        const response = await chrome.runtime.sendMessage({ 
            action: 'updateReservation', 
            apiKey, 
            flightData
        });
        
        if(response.status === 'ok') { // Asumiendo que tu endpoint de update devuelve 'ok'
            showStatus(ui, `Reserva ${index + 1} actualizada con éxito.`, 'success');
        } else {
            showStatus(ui, `Error al actualizar: ${response.message || 'Error desconocido'}`, 'error');
        }
    } catch (e) {
        showStatus(ui, `Error de comunicación al actualizar.`, 'error');
    } finally {
        showSpinner(ui, false);
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toPayloadDisplayValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function parsePayloadCellValue(raw) {
    if (raw === undefined || raw === null) return null;
    const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (s === '') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    const first = s.charAt(0);
    if (first === '[' || first === '{') {
        try { return JSON.parse(s); } catch (_) { return s; }
    }
    const num = Number(s);
    if (s !== '' && !Number.isNaN(num)) return num;
    return s;
}

function createPayloadRow(key, value) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #e5e7eb';
    const isObjectOrArray = value !== null && typeof value === 'object';
    const keySpan = document.createElement('span');
    keySpan.textContent = key;
    keySpan.style.cssText = 'font-weight:600; word-break:break-word;';
    const keyTd = document.createElement('td');
    keyTd.style.cssText = 'padding:6px 8px; vertical-align:top; width:34%;';
    keyTd.appendChild(keySpan);

    const valueCell = document.createElement('td');
    valueCell.style.cssText = 'padding:6px 8px; vertical-align:top; white-space:pre-wrap; word-break:break-word; font-size:12px;';
    const valueSpan = document.createElement(isObjectOrArray ? 'pre' : 'span');
    valueSpan.style.cssText = 'margin:0; font-family:inherit;';
    if (isObjectOrArray) {
        try {
            valueSpan.textContent = JSON.stringify(value, null, 2);
        } catch (_) {
            valueSpan.textContent = String(value);
        }
    } else {
        valueSpan.textContent = value === null || value === undefined ? '' : String(value);
    }
    valueCell.appendChild(valueSpan);

    tr.appendChild(keyTd);
    tr.appendChild(valueCell);
    return tr;
}

function showPayloadPreviewModal(payload, reservationIndex, ui) {
    const entries = Object.entries(payload || {}).sort(([a], [b]) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 16px;
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        width: min(920px, 96vw);
        max-height: 88vh;
        overflow: hidden;
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        display: flex;
        flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e5e7eb;';
    const title = document.createElement('h3');
    title.style.cssText = 'margin:0; font-size:16px; color:#111827;';
    title.textContent = `Payload a enviar (Reserva ${reservationIndex + 1})`;
    const headerBtns = document.createElement('div');
    headerBtns.style.cssText = 'display:flex; gap:8px; align-items:center;';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'closePayloadPreviewBtn';
    closeBtn.textContent = 'Cerrar';
    closeBtn.style.cssText = 'border:none; background:#f3f4f6; color:#374151; border-radius:6px; padding:6px 10px; cursor:pointer; font-weight:600;';
    headerBtns.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerBtns);
    modalContent.appendChild(header);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'padding:12px 16px; color:#4b5563; font-size:12px;';
    subtitle.textContent = 'Todos los campos que se enviarán al backend con esta reserva. Solo lectura.';
    modalContent.appendChild(subtitle);

    const scrollWrap = document.createElement('div');
    scrollWrap.style.cssText = 'padding:0 16px 16px 16px; overflow:auto; flex:1; min-height:0;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; table-layout:fixed; font-size:12px;';
    table.innerHTML = `
        <thead>
            <tr>
                <th style="text-align:left; padding:8px; border-bottom:2px solid #e5e7eb; width:34%;">Clave</th>
                <th style="text-align:left; padding:8px; border-bottom:2px solid #e5e7eb;">Valor</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    entries.forEach(([key, value]) => tbody.appendChild(createPayloadRow(key, value)));
    scrollWrap.appendChild(table);
    modalContent.appendChild(scrollWrap);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    const close = () => modal.remove();
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
}

async function openReservationPayloadPreview(ui, index) {
    try {
        const payload = await collectSingleFieldData(index);
        showPayloadPreviewModal(payload, index, ui);
    } catch (e) {
        showStatus(ui, `No se pudo generar la previsualización: ${e.message || e}`, 'error');
    }
}

// Campos específicos de billetes (campos adicionales cuando es tipo billetaje)
const BILLETAGE_FIELDS = [
    'trayecto',
    'codigo_billete',
    'segmentos',
    'fecha_emision_billete',
    'numero_billete',
    'tarifa',
    'clase_servicio',
    'codigo_reserva'
];

const OUTBOUND_SEGMENT_FIELDS = [
    'Ida_Compania',
    'Ida_Tarifa',
    'Ida_Codigo',
    'Ida_Origen_Fecha',
    'Ida_Origen_Hora',
    'Ida_Origen_Lugar',
    'Ida_Destino_Fecha',
    'Ida_Destino_Hora',
    'Ida_Destino_Lugar'
];

const RETURN_SEGMENT_FIELDS = [
    'Vuelta_Compania',
    'Vuelta_Tarifa',
    'Vuelta_Codigo',
    'Vuelta_Origen_Fecha',
    'Vuelta_Origen_Hora',
    'Vuelta_Origen_Lugar',
    'Vuelta_Destino_Fecha',
    'Vuelta_Destino_Hora',
    'Vuelta_Destino_Lugar'
];

// Orden preferido de impresión en front para mejorar lectura operativa.
const FRONT_FIELD_DISPLAY_ORDER = [
    'localizador',
    'codigo_reserva',
    'fecha_booking',
    'proveedor',
    'num_pasajeros',
    // Bloque económico (juntos)
    'precio',
    'divisa',
    'forma_pago',
    'venta',
    'coste',
    'markup',
    'fee'
];

function orderFieldsForFrontDisplay(fields) {
    if (!Array.isArray(fields) || fields.length === 0) return fields;
    const priority = new Map(FRONT_FIELD_DISPLAY_ORDER.map((field, idx) => [String(field).toLowerCase(), idx]));

    return [...fields].sort((a, b) => {
        const aKey = String(a || '').toLowerCase();
        const bKey = String(b || '').toLowerCase();
        const aPriority = priority.has(aKey) ? priority.get(aKey) : Number.MAX_SAFE_INTEGER;
        const bPriority = priority.has(bKey) ? priority.get(bKey) : Number.MAX_SAFE_INTEGER;
        return aPriority - bPriority;
    });
}

// Campos específicos de Gesintur para reserva_billete (según documento)
// Campos de Gesintur se obtienen del backend (no hardcodeados)

// --- HELPERS (Manipulación del DOM) ---
function createJourneyDropdownBlock(title, fields, data, index, fieldsToRenderSet, reservationType) {
    const allowedFields = fields.filter(field => fieldsToRenderSet.has(field));
    if (allowedFields.length === 0) return null;

    const grid = document.createElement('div');
    grid.className = 'fields-grid-container';
    grid.style.marginTop = '10px';

    allowedFields.forEach(field => {
        const fieldElement = createFieldElement(field, data[field], index, { reservationType });
        if (fieldElement) grid.appendChild(fieldElement);
    });

    const section = createCollapsibleFieldsSection(title, grid, 'field-group-details');
    return section;
}

function createCollapsibleFieldsSection(title, contentNode, sectionClass = 'field-group-details') {
    if (!contentNode) return null;
    if (contentNode.childElementCount === 0) return null;

    const section = document.createElement('div');
    section.className = sectionClass;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'capdata-collapse-toggle';
    summary.textContent = title;
    details.appendChild(summary);
    details.appendChild(contentNode);
    details.addEventListener('toggle', notifySizeChange);
    section.appendChild(details);
    return section;
}

function getActiveIntegrationSectionTitle(integrationName) {
    return `Campos específicos de ${integrationName}`;
}

// Spinner DENTRO de un input mientras se busca su NIF en CapData. Envuelve el input
// en un contenedor relativo y añade el spinner a la derecha. Devuelve cleanup().
function _attachNifSpinner(input) {
    try {
        if (!document.getElementById('orbis-spin-style')) {
            const st = document.createElement('style');
            st.id = 'orbis-spin-style';
            st.textContent = '@keyframes orbisspin{from{transform:translateY(-50%) rotate(0deg)}to{transform:translateY(-50%) rotate(360deg)}}';
            (document.head || document.documentElement).appendChild(st);
        }
        let wrap = input.parentElement;
        if (!wrap || !wrap.classList || !wrap.classList.contains('nif-spin-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'nif-spin-wrap';
            wrap.style.cssText = 'position:relative;';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
        }
        const sp = document.createElement('div');
        sp.style.cssText = 'position:absolute;right:9px;top:50%;width:13px;height:13px;border:2px solid #d1d5db;border-top-color:#2563eb;border-radius:50%;animation:orbisspin .8s linear infinite;pointer-events:none;';
        wrap.appendChild(sp);
        const prevPad = input.style.paddingRight;
        input.style.paddingRight = '28px';
        return () => { try { sp.remove(); input.style.paddingRight = prevPad; } catch (_) {} };
    } catch (_) { return () => {}; }
}

// Autorrellena el NIF de cada pasajero buscándolo en CapData por NOMBRE, con
// feedback: spinner mientras busca; si llega lo pinta; si no, lo deja vacío con un
// placeholder indicando que no está en CapData. El NIF se envía a Orbis como titular
// del servicio (evita el "JUAN MARTINEZ" por defecto cuando va vacío).
async function autofillPassengerNifs() {
    try {
        const apiKey = await _orbisGetApiKey();
        if (!apiKey) return;
        const nifInputs = Array.from(document.querySelectorAll('.pax-data-input[data-key="nif"]'));

        const lookupOne = async (nifInput) => {
            const resIdx = nifInput.getAttribute('data-res-index');
            const paxIdx = nifInput.getAttribute('data-pax-index');
            const nameInput = document.querySelector(
                `.pax-data-input[data-key="nombre_pax"][data-res-index="${resIdx}"][data-pax-index="${paxIdx}"]`
            );
            const name = nameInput ? (nameInput.value || '').trim() : '';
            if (!name) return;
            const cleanup = _attachNifSpinner(nifInput);
            const prevPlaceholder = nifInput.placeholder;
            nifInput.placeholder = 'Buscando NIF en CapData…';
            // Duración mínima del spinner para que sea VISIBLE (el lookup local es rapidísimo).
            const minDelay = new Promise((r) => setTimeout(r, 650));
            try {
                const resp = await chrome.runtime.sendMessage({ action: 'lookupPassengerNif', apiKey, name });
                await minDelay;
                if (resp && resp.status === 'success' && resp.nif && !(nifInput.value || '').trim()) {
                    nifInput.value = resp.nif;
                    nifInput.placeholder = prevPlaceholder;
                    // 'change' (no 'input'): la sincronización de pasajeros a
                    // savedReservationData escucha 'change'; con 'input' no se guarda.
                    nifInput.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (!(nifInput.value || '').trim()) {
                    nifInput.placeholder = 'Sin NIF en CapData — escríbelo a mano';
                }
            } catch (e) {
                await minDelay;
                nifInput.placeholder = prevPlaceholder;
            } finally {
                cleanup();
            }
        };

        // En paralelo: todos los pasajeros sin NIF muestran spinner a la vez.
        await Promise.all(
            nifInputs.filter((inp) => !(inp.value || '').trim()).map((inp) => lookupOne(inp))
        );
    } catch (e) { /* silencioso */ }
}

// === ORBISWEB Fase 2: desplegable de PRODUCTO del proveedor ===
// Solo con OrbisWeb activo. Resuelve el proveedor en el backend (por nombre/NIF o
// numIdProveedor) y carga sus productos; el elegido se guarda en
// reservation.num_id_producto y viaja como productoProveedor en la línea de servicio.
function buildOrbiswebProductSelector(data, reservationsData) {
    const container = document.createElement('div');
    container.className = 'orbisweb-product-selector erp-fields-block';
    container.style.cssText = 'display:none; margin:10px 0; padding:10px 12px; border:1px solid #bfdbfe; border-radius:8px; background:#f0f9ff;';

    const label = document.createElement('label');
    label.textContent = 'Producto del proveedor (Orbis)';
    label.style.cssText = 'display:block; font-size:12px; font-weight:600; color:#0369a1; margin-bottom:4px;';
    container.appendChild(label);

    const select = document.createElement('select');
    select.className = 'orbisweb-product-select';
    select.style.cssText = 'width:100%; padding:6px 8px; border:1px solid #93c5fd; border-radius:6px; font-size:13px; background:#fff;';
    container.appendChild(select);

    const status = document.createElement('div');
    status.style.cssText = 'font-size:11px; color:#64748b; margin-top:4px;';
    container.appendChild(status);

    select.addEventListener('change', () => {
        data.num_id_producto = select.value || '';
        try { chrome.storage.local.set({ savedReservationData: reservationsData }); } catch (e) {}
    });

    // Usar el mismo dropdown custom posicionado que el resto de selects del form
    // (el <select> nativo se renderiza flotando mal dentro del popup).
    if (typeof enhanceSelectWithFixedDropdown === 'function') {
        try { enhanceSelectWithFixedDropdown(select); } catch (e) {}
    }

    loadOrbiswebProducts(data, select, status, container);
    return container;
}

async function loadOrbiswebProducts(data, select, status, container) {
    const apiKey = (document.getElementById('apiKey')?.value || '').trim();
    if (!apiKey) return;
    const numId = data.numIdProveedor || data.num_id_proveedor || '';
    const proveedor = data.proveedor_nombre || data.proveedor || data.via || '';
    const nif = data.proveedor_documento || data.provider_nif || '';
    if (!numId && !proveedor && !nif) return;
    container.style.display = 'block';
    status.textContent = 'Cargando productos del proveedor…';
    try {
        const url = new URL(`${POPUP_API_BASE_URL}/api/me/provider-products`);
        if (numId) url.searchParams.set('num_id_proveedor', numId);
        if (proveedor) url.searchParams.set('proveedor', proveedor);
        if (nif) url.searchParams.set('nif', nif);
        const resp = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } });
        const json = await resp.json().catch(() => ({}));
        const products = (json && Array.isArray(json.products)) ? json.products : [];
        if (!products.length) { container.style.display = 'none'; return; }
        select.innerHTML = '';
        const optDef = document.createElement('option');
        optDef.value = '';
        optDef.textContent = '— Producto por defecto del proveedor —';
        select.appendChild(optDef);
        let preselect = '';
        products.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = String(p.num_id_producto);
            opt.textContent = (p.nombre || p.num_id_producto) + (p.tipo ? ' · ' + p.tipo : '');
            select.appendChild(opt);
            if (p.is_default && !preselect) preselect = String(p.num_id_producto);
        });
        if (!preselect && products.length === 1) preselect = String(products[0].num_id_producto);
        if (data.num_id_producto) preselect = String(data.num_id_producto);
        select.value = preselect || '';
        data.num_id_producto = select.value || '';
        // Sincroniza la etiqueta del trigger custom tras la carga asíncrona.
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const provTxt = json.num_id_proveedor ? ` · proveedor ${json.num_id_proveedor}` : '';
        status.textContent = `${products.length} producto(s)${provTxt}. Elige uno o deja el predeterminado.`;
        container.style.display = 'block';
    } catch (e) {
        container.style.display = 'none';
    }
}

function buildMultiEditableForm(ui, reservationsData) {
    // 1. Limpiar el contenedor de cualquier formulario anterior.
    closeActiveCustomSelectDropdown();
    ui.standardFieldsContainer.innerHTML = '';
    
    // 2. Iterar sobre cada reserva encontrada y construir su sección en el formulario.
    reservationsData.forEach((data, index) => {
        // --- A) DETERMINAR EL TIPO DE SERVICIO Y NORMALIZARLO ---
        let rawResType = data.reservation_type || selectedReservationType || 'aereo';
        const resTypeBase = getReservationTypeBase(rawResType); 
        const shouldUseGenericDescription = isGiavReservationFlow(rawResType);
        
        // --- B) SELECCIONAR LISTA DE CAMPOS DE FORMA SEGURA ---
        let fieldsToRender = [];
        if (typeof ALL_SERVICE_FIELDS !== 'undefined' && ALL_SERVICE_FIELDS && ALL_SERVICE_FIELDS[resTypeBase]) {
            fieldsToRender = ALL_SERVICE_FIELDS[resTypeBase];
        } else if (typeof STANDARD_FIELDS !== 'undefined' && STANDARD_FIELDS) {
            fieldsToRender = STANDARD_FIELDS;
        }

        // Aseguramos que 'precio' esté presente si hay campos económicos
        fieldsToRender = [...new Set(fieldsToRender)];
        fieldsToRender = applyExclusiveGestionFields(fieldsToRender, rawResType);
        const hasVentaOrCoste = fieldsToRender.includes('venta') || fieldsToRender.includes('coste');
        if (hasVentaOrCoste && !fieldsToRender.includes('precio')) {
            fieldsToRender.push('precio');
        }
        if (shouldUseGenericDescription && !fieldsToRender.includes('descripcion')) {
            fieldsToRender.push('descripcion');
        }
        fieldsToRender = orderFieldsForFrontDisplay(fieldsToRender);

        console.log(`[POPUP][RENDER] Reserva ${index + 1}`, {
            reservation_type: data.reservation_type,
            totalFieldsInData: Object.keys(data || {}).length,
            fieldsToRenderCount: fieldsToRender.length,
            customSchemaCount: Array.isArray(window.CUSTOM_SCHEMA) ? window.CUSTOM_SCHEMA.length : 0
        });

        if (shouldUseGenericDescription) {
            const genericDescription = buildGenericFlightDescription(data);
            if (genericDescription) {
                data.descripcion = genericDescription;
            }
        }

        // Crear el contenedor principal para esta reserva.
        const wrapper = document.createElement('div');
        wrapper.className = 'reservation-form-wrapper';
        
        const title = document.createElement('h3');
        const displayType = rawResType.replace(/_/g, ' ').toUpperCase();
        title.textContent = `${displayType} - Reserva ${index + 1} (${data.codigo_reserva || 'Sin código'})`;
        wrapper.appendChild(title);

        // 3. CONTENEDOR DE CAMPOS EN GRID DE 2 COLUMNAS
        const fieldsGridContainer = document.createElement('div');
        fieldsGridContainer.className = 'fields-grid-container';

        const fieldsToRenderSet = new Set(fieldsToRender);

        const giavAutomationFields = ['accion', 'codigo_oficina', 'codigo_expediente', 'accion_facturacion'];

        // 3.1 Dibujar campos dinámicos generales
        fieldsToRender.forEach(field => {
            if (field === 'pasajeros' || field === 'num_pasajeros' || field === 'proveedor_nombre') return;
            if (field === 'descripcion' && !shouldUseGenericDescription) return;
            if (OUTBOUND_SEGMENT_FIELDS.includes(field) || RETURN_SEGMENT_FIELDS.includes(field)) return;
            if (giavAutomationFields.includes(field)) return;
            if (resTypeBase === 'aereo' && normalizeFieldSlug(field) === 'codigoreserva') return;

            const fieldElement = createFieldElement(field, data[field], index, { reservationType: rawResType });
            // VALIDACIÓN CRÍTICA: Solo hacer append si el elemento no es null
            if (fieldElement) {
                fieldsGridContainer.appendChild(fieldElement);
            }
        });
        
        wrapper.appendChild(fieldsGridContainer);

        // 3.2 Bloques desplegables de segmentos (Ida / Vuelta)
        const outboundBlock = createJourneyDropdownBlock('Ver/Ocultar campos de Ida', OUTBOUND_SEGMENT_FIELDS, data, index, fieldsToRenderSet, rawResType);
        if (outboundBlock) wrapper.appendChild(outboundBlock);
        
        const returnBlock = createJourneyDropdownBlock('Ver/Ocultar campos de Vuelta', RETURN_SEGMENT_FIELDS, data, index, fieldsToRenderSet, rawResType);
        if (returnBlock) wrapper.appendChild(returnBlock);
        
        // 4. LÓGICA DE PASAJEROS (Fuera del grid)
        // Mostramos SIEMPRE el recuadro de pasajeros (aunque la captura no haya
        // traído ninguno), partiendo de un pasajero vacío, para que el usuario
        // pueda rellenarlo a mano si la captura no lo encontró.
        if (fieldsToRender.includes('pasajeros')) {
            const showPassengerDescription = !isGiavReservationFlow(rawResType);
            const paxData = (Array.isArray(data.pasajeros) && data.pasajeros.length > 0)
                ? data.pasajeros
                : [{}];
            const passengersElement = createFieldElement('pasajeros', paxData, index, { showPassengerDescription, reservationType: rawResType });
            if (passengersElement) {
                wrapper.appendChild(passengersElement);
            }
        }

        // 4.1 Campos de automatización GIAV bajo pasajeros (entre dos franjas)
        if (typeof cachedGesinturStatus !== 'undefined' && cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false) {
            const gesinturSchemaFields = new Set([
                ...(Array.isArray(GESINTUR_NORMAL_FIELDS) ? GESINTUR_NORMAL_FIELDS : []),
                ...(Array.isArray(GESINTUR_BILETE_FIELDS) ? GESINTUR_BILETE_FIELDS : [])
            ]);
            const giavVisibleFields = giavAutomationFields
                .map((field) => {
                    const aliases = getGesinturFieldAliases(field);
                    if (!aliases.some((alias) => isIntegrationFieldVisible('gesintur', alias))) return null;
                    const renderField = resolveGesinturFieldForRender(field, data, gesinturSchemaFields);
                    return {
                        renderField,
                        value: getGesinturFieldValue(data, field)
                    };
                })
                .filter(Boolean);
            if (giavVisibleFields.length > 0) {
                const fieldsDiv = document.createElement('div');
                fieldsDiv.className = 'fields-grid-container';
                giavVisibleFields.forEach(({ renderField, value }) => {
                    const el = createFieldElement(renderField, value, index, { reservationType: rawResType });
                    if (el) {
                        const input = el.querySelector('input, select, textarea');
                        if (input) {
                            input.id = `gesintur_${renderField}_${index}`;
                            input.name = `gesintur_${renderField}_${index}`;
                        }
                        fieldsDiv.appendChild(el);
                    }
                });
                fieldsDiv.style.marginTop = '10px';
                const giavAutomationContainer = createCollapsibleFieldsSection(
                    getActiveIntegrationSectionTitle('Gesintur'),
                    fieldsDiv,
                    'giav-automation-fields-container erp-fields-block field-group-details'
                );
                if (giavAutomationContainer) {
                    wrapper.appendChild(giavAutomationContainer);
                }
            }
        }

        // --- SECCIONES DE INTEGRACIÓN (CON PROTECCIÓN CONTRA ELEMENTOS NULL) ---

        // A) Lógica de Billetaje
        if (typeof cachedGesinturStatus !== 'undefined' && cachedGesinturStatus && rawResType === 'billetaje') {
            const billetageContainer = document.createElement('div');
            billetageContainer.className = 'billetage-fields-container';
            billetageContainer.style.cssText = 'margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ccc;';
            
            const bTitle = document.createElement('h4');
            bTitle.textContent = 'Campos adicionales de Billetaje';
            bTitle.style.cssText = 'font-size: 14px; color: #0672ff; margin-bottom: 12px;';
            billetageContainer.appendChild(bTitle);
            
            const billetageFieldsDiv = document.createElement('div');
            billetageFieldsDiv.className = 'fields-grid-container';
            
            if (typeof BILLETAGE_FIELDS !== 'undefined' && BILLETAGE_FIELDS) {
                BILLETAGE_FIELDS.forEach(field => {
                    const el = createFieldElement(field, data[field], index, { reservationType: rawResType });
                    if (el) billetageFieldsDiv.appendChild(el);
                });
            }
            billetageContainer.appendChild(billetageFieldsDiv);
            wrapper.appendChild(billetageContainer);
        }

        // B) Integración con AVSIS (solo si está activa y visible); visibilidad por campo se gestiona en el mapeador
        if (typeof cachedAvsisStatus !== 'undefined' && cachedAvsisStatus && cachedIntegrationVisibility.avsis !== false) {
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            if (typeof AVSIS_SPECIFIC_FIELDS !== 'undefined' && AVSIS_SPECIFIC_FIELDS) {
                AVSIS_SPECIFIC_FIELDS.forEach(field => {
                    if (!isIntegrationFieldVisible('avsis', field)) return;
                    const el = createFieldElement(field, data[field], index, { reservationType: rawResType });
                    if (el) {
                        const input = el.querySelector('input, select, textarea');
                        if (input) {
                            input.id = `avsis_${field}_${index}`;
                            input.name = `avsis_${field}_${index}`;
                        }
                        fieldsDiv.appendChild(el);
                    }
                });
            }
            fieldsDiv.style.marginTop = '10px';
            const avsisSection = createCollapsibleFieldsSection(
                getActiveIntegrationSectionTitle('AVSIS'),
                fieldsDiv,
                'avsis-fields-container erp-fields-block field-group-details'
            );
            if (avsisSection) wrapper.appendChild(avsisSection);
        }

        // C) Integración con Gesintur (solo si está activa y visible); visibilidad por campo se gestiona en el mapeador
        if (typeof cachedGesinturStatus !== 'undefined' && cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false) {
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            const gesinturFields = (rawResType === 'billetaje' || resTypeBase === 'aereo')
                ? (typeof GESINTUR_BILETE_FIELDS !== 'undefined' ? GESINTUR_BILETE_FIELDS : [])
                : (typeof GESINTUR_NORMAL_FIELDS !== 'undefined' ? GESINTUR_NORMAL_FIELDS : []);
            gesinturFields.forEach(field => {
                if (giavAutomationFields.includes(field)) return;
                if (!isIntegrationFieldVisible('gesintur', field)) return;
                const el = createFieldElement(field, data[field], index, { reservationType: rawResType });
                if (el) {
                    const input = el.querySelector('input, select, textarea');
                    if (input) {
                        input.id = `gesintur_${field}_${index}`;
                        input.name = `gesintur_${field}_${index}`;
                    }
                    fieldsDiv.appendChild(el);
                }
            });
            fieldsDiv.style.marginTop = '10px';
            const gesinturSection = createCollapsibleFieldsSection(
                getActiveIntegrationSectionTitle('Gesintur'),
                fieldsDiv,
                'gesintur-fields-container erp-fields-block field-group-details'
            );
            if (gesinturSection) wrapper.appendChild(gesinturSection);
        }

        // D) Integración con ORBISWEB/Pipeline (solo si está activa y visible); visibilidad por campo se gestiona en el mapeador
        if (typeof cachedOrbiswebStatus !== 'undefined' && cachedOrbiswebStatus && cachedIntegrationVisibility.orbisweb !== false) {
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            if (typeof PIPELINE_ORBISWEB_FIELDS !== 'undefined' && PIPELINE_ORBISWEB_FIELDS) {
                PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                    if (!isIntegrationFieldVisible('orbisweb', field)) return;
                    const isPnrOrGds = (field.toLowerCase() === 'strlocalizadorpnr' || field.toLowerCase() === 'strlocalizadorgds');
                    const isBOneWayField = field.toLowerCase() === 'boneway';
                    const computedBOneWay = hasReturnJourneyData(data) ? 0 : 1;
                    const value = isBOneWayField
                        ? computedBOneWay
                        : ((isPnrOrGds && (data[field] == null || data[field] === ''))
                            ? getGeneralLocatorValue(index, data)
                            : (data[field] ?? ''));

                    if (isBOneWayField) {
                        data[field] = computedBOneWay;
                    }

                    const el = createFieldElement(field, value, index, { reservationType: rawResType });
                    if (el) {
                        const input = el.querySelector('input, select, textarea');
                        if (input) {
                            input.id = `pipeline_${field}_${index}`;
                            input.name = `pipeline_${field}_${index}`;
                            const requiredOrbis = ['strlocalizadorpnr', 'strlocalizadorgds'];
                            if (requiredOrbis.includes(field.toLowerCase())) {
                                input.required = true;
                                input.setAttribute('data-required-orbisweb', 'true');
                                const labelTag = el.querySelector('label');
                                if (labelTag) labelTag.innerHTML += ' <span style="color: red;">*</span>';
                            }
                        }
                        fieldsDiv.appendChild(el);
                    }
                });
            }
            fieldsDiv.style.marginTop = '10px';
            // --- ORBISWEB (Fase 2): desplegable de PRODUCTO del proveedor, dentro de la sección ---
            const orbisSectionContent = document.createElement('div');
            const orbisProductSelector = buildOrbiswebProductSelector(data, reservationsData);
            if (orbisProductSelector) orbisSectionContent.appendChild(orbisProductSelector);
            orbisSectionContent.appendChild(fieldsDiv);
            const pipelineSection = createCollapsibleFieldsSection(
                getActiveIntegrationSectionTitle('ORBISWEB'),
                orbisSectionContent,
                'pipeline-fields-container erp-fields-block field-group-details'
            );
            if (pipelineSection) wrapper.appendChild(pipelineSection);
        }

        // =========================================================================
        // SECCIÓN DE CAMPOS PERSONALIZADOS PRIVADOS (AL FINAL)
        // =========================================================================
        const customFieldsContainer = document.createElement('div');
        customFieldsContainer.className = 'custom-fields-container erp-fields-block';
        const customGrid = document.createElement('div');
        customGrid.className = 'fields-grid-container';

        let hasVisibleCustom = false;
        if (window.CUSTOM_SCHEMA && Array.isArray(window.CUSTOM_SCHEMA)) {
            window.CUSTOM_SCHEMA.forEach(cf => {
                // FILTRO DE VISIBILIDAD: Solo mostramos el input si es visible. Los ocultos no se muestran pero SÍ se procesan y se envían al backend.
                const isVisible = (cf.is_visible === true || cf.is_visible === 1 || cf.is_visible === "1");
                const hasValue = data[cf.slug] !== undefined && data[cf.slug] !== null && String(data[cf.slug]).trim() !== '';

                console.log(`[POPUP][CUSTOM] slug=${cf.slug} visible=${isVisible} hasValue=${hasValue}`, {
                    valueType: Array.isArray(data[cf.slug]) ? 'array' : typeof data[cf.slug],
                    value: data[cf.slug]
                });

                if (!isVisible) return; // No pintar input; el valor se envía igual en el payload

                const val = data[cf.slug] !== undefined ? data[cf.slug] : "";
                const el = createFieldElement(cf.slug, val, index, { reservationType: rawResType });
                if (el) {
                    customGrid.appendChild(el);
                    hasVisibleCustom = true;
                } else {
                    console.warn(`[POPUP][CUSTOM] createFieldElement devolvió null para ${cf.slug}`);
                }
            });
        }

        if (hasVisibleCustom) {
            const cfTitle = document.createElement('h4');
            cfTitle.textContent = 'Mis Campos Personalizados';
            cfTitle.style.cssText = 'font-size: 14px; color: #28a745; margin-bottom: 12px; font-weight: bold; border-top: 1px dashed #eee; padding-top: 10px;';
            customFieldsContainer.appendChild(cfTitle);
            customFieldsContainer.appendChild(customGrid);
            wrapper.appendChild(customFieldsContainer);
        }

        // 5. BOTÓN DE ACCIÓN INDIVIDUAL
        const payloadPreviewBtn = document.createElement('button');
        payloadPreviewBtn.textContent = 'Ver datos a enviar';
        payloadPreviewBtn.className = 'view-payload-btn';
        payloadPreviewBtn.disabled = false;
        payloadPreviewBtn.title = "Ver todos los campos que se enviarán al backend";
        payloadPreviewBtn.addEventListener('click', () => openReservationPayloadPreview(ui, index));
        wrapper.appendChild(payloadPreviewBtn);
        
        ui.standardFieldsContainer.appendChild(wrapper);
    });

    // =========================================================================
    // 7. SINCRONIZACIÓN DE DATOS (ROOT Y PASAJEROS)
    // =========================================================================
    
    // A) Sincronizar inputs raíz (venta, localizador, etc.)
    ui.standardFieldsContainer.querySelectorAll('input, select, textarea').forEach(input => {
        if (input.classList.contains('pax-data-input')) return;

        input.addEventListener('change', (e) => {
            const { field, resIdx } = parseRootFormInputMeta(e.target);

            if (field && resIdx !== undefined && resIdx !== null && reservationsData[resIdx]) {
                const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                reservationsData[resIdx][field] = val;
                if (field === 'forma_pago') {
                    updateBspVisualForReservation(Number(resIdx), reservationsData);
                }
                chrome.storage.local.set({ savedReservationData: reservationsData });
            }
        });
    });

    // Inicializar BSP visual
    reservationsData.forEach((_, resIdx) => {
        updateBspVisualForReservation(resIdx, reservationsData);
    });

    // B) Sincronizar inputs de PASAJEROS
    ui.standardFieldsContainer.querySelectorAll('.pax-data-input').forEach(input => {
        if (input.getAttribute('data-key') === 'num_billete') {
            input.addEventListener('input', (e) => {
                e.target.value = normalizeTicketNumberValue(e.target.value);
            });
        }
        input.addEventListener('change', (e) => {
            const resIdx = e.target.getAttribute('data-res-index');
            const paxIdx = e.target.getAttribute('data-pax-index');
            const key = e.target.getAttribute('data-key');

            if (resIdx !== null && paxIdx !== null && key && reservationsData[resIdx]) {
                const val = (e.target.type === 'checkbox')
                    ? e.target.checked
                    : ((key === 'is_residente' || key === 'is_familia_numerosa' || key === 'residente_fam_numerosa')
                        ? (e.target.value === 'true')
                        : (key === 'num_billete'
                            ? normalizeTicketNumberValue(e.target.value)
                            : e.target.value));
                if (key === 'num_billete') {
                    e.target.value = val;
                }
                if (!reservationsData[resIdx].pasajeros) reservationsData[resIdx].pasajeros = [];
                // Si la fila de pasajero no existía (recuadro vacío mostrado para
                // que el usuario lo rellene a mano), la creamos para no perder lo
                // que escriba.
                if (!reservationsData[resIdx].pasajeros[paxIdx]) {
                    reservationsData[resIdx].pasajeros[paxIdx] = {};
                }
                reservationsData[resIdx].pasajeros[paxIdx][key] = val;
                chrome.storage.local.set({ savedReservationData: reservationsData });
            }
        });
    });

    // 8. GESTIÓN FINAL DE VISIBILIDAD
    ui.formContainer.style.display = 'block';
    ui.capturarReservaBtn.style.display = 'none';
    ui.globalActionsRow.style.display = 'flex';
    ui.saveAllBtn.style.display = 'inline-block';
    ui.discardBtn.style.display = 'inline-block';
    ui.saveAllBtn.disabled = false;
    if (isLastCaptureSavedLocked) {
        lockCapturedFormFields(ui);
        ui.saveAllBtn.style.display = 'none';
        ui.discardBtn.style.display = 'none';
        ui.clearBtn.style.display = 'inline-block';
    }

    if (typeof notifySizeChange === 'function') {
        notifySizeChange();
    }

    // Autorrelleno del NIF de los pasajeros desde CapData (por nombre), para que
    // Orbis identifique correctamente al titular del servicio. SOLO con Orbis activo:
    // con otras integraciones (o ninguna) el NIF del pasajero ni se muestra ni se busca.
    const _orbisActiveForNif = cachedOrbiswebStatus
        && (typeof cachedIntegrationVisibility === 'undefined' || cachedIntegrationVisibility.orbisweb !== false);
    if (_orbisActiveForNif && typeof autofillPassengerNifs === 'function') {
        autofillPassengerNifs();
    }
}

// ============================================================================
// Panel de progreso del guardado (checklist en vivo)
// ----------------------------------------------------------------------------
// Pinta los pasos REALES que el backend reporta durante POST
// /api/save_all_reservations vía polling al endpoint
// /api/save_all_reservations/progress/<id>.
//
// No simula nada: si el backend no devuelve un paso (porque la integración no
// está activa) ese paso no aparece. Si un paso falla, aparece en rojo.
// ============================================================================

const SAVE_PROGRESS_POLL_INTERVAL_MS = 450;

function _genSaveProgressRequestId() {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
    } catch (_) { /* noop */ }
    return 'sp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function _saveProgressEls() {
    return {
        panel: document.getElementById('saveProgressPanel'),
        title: document.getElementById('saveProgressTitle'),
        count: document.getElementById('saveProgressCount'),
        stepsContainer: document.getElementById('saveProgressSteps'),
        final: document.getElementById('saveProgressFinal'),
    };
}

function showSaveProgressPanel(initialReservationCount) {
    const els = _saveProgressEls();
    if (!els.panel) return;
    els.panel.classList.remove('is-error', 'is-done');
    els.title.textContent = (initialReservationCount && initialReservationCount > 1)
        ? `Guardando ${initialReservationCount} reservas...`
        : 'Guardando reserva...';
    els.count.textContent = '';
    els.final.textContent = '';
    els.final.style.display = 'none';
    // Estado inicial: un solo paso "Conectando con el servidor..." en pending.
    // Se reemplaza en cuanto llegue la primera respuesta del polling con los
    // pasos reales del backend.
    els.stepsContainer.innerHTML = `
        <div class="sp-step is-running" data-step-key="__bootstrap">
            <span class="sp-step-icon">·</span>
            <div class="sp-step-body">
                <div class="sp-step-label">Conectando con el servidor...</div>
                <div class="sp-step-msg"></div>
            </div>
        </div>
    `;
    els.panel.style.display = 'block';
}

function hideSaveProgressPanel(delayMs = 0) {
    const els = _saveProgressEls();
    if (!els.panel) return;
    const doHide = () => { els.panel.style.display = 'none'; };
    if (delayMs > 0) {
        setTimeout(doHide, delayMs);
    } else {
        doHide();
    }
}

function _renderSaveProgressSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return '';
    return steps.map((s) => {
        const status = (s && s.status) || 'pending';
        const label = (s && s.label) || s.key || '';
        const msg = s && s.message ? String(s.message) : '';
        let iconChar = '';
        if (status === 'done') iconChar = '✓';
        else if (status === 'error') iconChar = '✕';
        else if (status === 'skipped') iconChar = '—';
        else if (status === 'pending') iconChar = '·';
        // running: el spinner lo dibuja el CSS, el icon va vacío.

        // Escape mínimo (los mensajes vienen de nuestro backend, pero por si acaso)
        const safeLabel = label.replace(/[<>&]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[c]));
        const safeMsg = msg.replace(/[<>&]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[c]));

        return `
            <div class="sp-step is-${status}" data-step-key="${s.key || ''}">
                <span class="sp-step-icon">${iconChar}</span>
                <div class="sp-step-body">
                    <div class="sp-step-label">${safeLabel}</div>
                    ${safeMsg ? `<div class="sp-step-msg">${safeMsg}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function updateSaveProgressFromBackend(progressData) {
    const els = _saveProgressEls();
    if (!els.panel || !progressData) return;
    const steps = Array.isArray(progressData.steps) ? progressData.steps : [];
    const overall = progressData.overall_status || 'running';

    // Solo re-renderizamos si la "huella" cambió, para no parpadear el DOM
    // en cada tick de polling cuando no hay novedades.
    const fingerprint = JSON.stringify(steps.map(s => [s.key, s.status, s.message]));
    if (els.panel.dataset.lastFingerprint !== fingerprint) {
        els.panel.dataset.lastFingerprint = fingerprint;
        els.stepsContainer.innerHTML = _renderSaveProgressSteps(steps);
    }

    // Contador en cabecera: X/Y pasos completados (excluyendo skipped).
    const total = steps.filter(s => s.status !== 'skipped').length;
    const done = steps.filter(s => s.status === 'done').length;
    els.count.textContent = total > 0 ? `${done}/${total}` : '';

    els.panel.classList.toggle('is-error', overall === 'error');
    els.panel.classList.toggle('is-done', overall === 'done');

    if (overall === 'done' && progressData.final_message) {
        els.title.textContent = '✅ Guardado completado';
        els.final.textContent = progressData.final_message;
        els.final.style.display = 'block';
    } else if (overall === 'error') {
        els.title.textContent = '❌ Error en el guardado';
        if (progressData.final_message) {
            els.final.textContent = progressData.final_message;
            els.final.style.display = 'block';
        }
    }
}

function startSaveProgressPolling(apiKey, requestId, onUpdate) {
    let stopped = false;
    let consecutiveNotFound = 0;

    const tick = async () => {
        if (stopped) return;
        try {
            const resp = await chrome.runtime.sendMessage({
                action: 'getSaveProgress',
                apiKey,
                requestId,
            });
            if (stopped) return;
            if (resp && resp.status === 'ok' && resp.progress) {
                consecutiveNotFound = 0;
                try { onUpdate(resp.progress); } catch (e) { console.warn('Render progreso:', e); }
            } else if (resp && resp.status === 'not_found') {
                // El backend todavía no ha creado la fila. Es normal en los
                // primeros 1-2 ticks; si pasa de 25 (~11s) abandonamos.
                consecutiveNotFound += 1;
                if (consecutiveNotFound > 25) {
                    stopped = true;
                    return;
                }
            }
            // network_error / forbidden / error: silencioso, reintentamos
        } catch (e) {
            // Errores duros (extensión recargada, etc.): paramos.
            stopped = true;
            return;
        }
        if (!stopped) {
            setTimeout(tick, SAVE_PROGRESS_POLL_INTERVAL_MS);
        }
    };
    setTimeout(tick, SAVE_PROGRESS_POLL_INTERVAL_MS);

    return {
        stop() { stopped = true; }
    };
}

function finalizeSaveProgressFromResponse(response) {
    // Caso de seguridad: si el polling no llegó a recibir el estado final
    // (porque la respuesta del POST vino más rápido que el siguiente tick),
    // pintamos el resultado a partir de la respuesta HTTP del POST.
    const els = _saveProgressEls();
    if (!els.panel || els.panel.style.display === 'none') return;
    // Si ya pintamos un estado final (done o error), no sobrescribimos.
    if (els.panel.classList.contains('is-done') || els.panel.classList.contains('is-error')) {
        return;
    }
    if (response && response.status === 'ok') {
        els.panel.classList.add('is-done');
        els.title.textContent = '✅ Guardado completado';
        if (response.message) {
            els.final.textContent = response.message;
            els.final.style.display = 'block';
        }
    } else {
        els.panel.classList.add('is-error');
        els.title.textContent = '❌ Error en el guardado';
        if (response && response.message) {
            els.final.textContent = response.message;
            els.final.style.display = 'block';
        }
    }
}

function markSaveProgressRetrySucceeded(message) {
    // Tras un reenvío manual a ORBISWEB con éxito, el checklist de guardado se
    // había quedado en rojo (el polling paró al fallar el POST). Repintamos los
    // pasos en error a verde y la cabecera a "completado" para que no parezca un fallo.
    const els = _saveProgressEls();
    if (!els.panel || els.panel.style.display === 'none') return;

    const errorSteps = els.stepsContainer
        ? els.stepsContainer.querySelectorAll('.sp-step.is-error')
        : [];
    errorSteps.forEach((stepEl) => {
        stepEl.classList.remove('is-error');
        stepEl.classList.add('is-done');
        const icon = stepEl.querySelector('.sp-step-icon');
        if (icon) icon.textContent = '✓';
        const msgEl = stepEl.querySelector('.sp-step-msg');
        if (msgEl) msgEl.textContent = 'Reenviado correctamente a Orbis Web';
    });

    els.panel.classList.remove('is-error');
    els.panel.classList.add('is-done');
    if (els.title) els.title.textContent = '✅ Guardado completado';
    if (els.final && message) {
        els.final.textContent = message;
        els.final.style.display = 'block';
    }

    // Recalcular el contador X/Y de la cabecera (un error pasó a done).
    try {
        const allSteps = els.stepsContainer.querySelectorAll('.sp-step');
        let total = 0, done = 0;
        allSteps.forEach((st) => {
            if (st.classList.contains('is-skipped')) return;
            total += 1;
            if (st.classList.contains('is-done')) done += 1;
        });
        if (els.count) els.count.textContent = total > 0 ? `${done}/${total}` : '';
    } catch (e) { /* contador es cosmético */ }
}

async function saveAllNewReservations(ui) {
    scrollPopupToTop(ui);

    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        alert("Por favor, ingresa tu API Key.");
        return;
    }
    
    // Validar campos requeridos de orbisweb antes de guardar
    // console.log("🔍 Validando orbisweb - cachedOrbiswebStatus:", cachedOrbiswebStatus);
    if (cachedOrbiswebStatus) {
        const validationError = validateAllOrbiswebRequiredFields();
        // console.log("🔍 Resultado de validación:", validationError);
        if (validationError) {
            showStatus(ui, validationError, 'error');
            ui.saveAllBtn.disabled = false; // Rehabilitar el botón si hay error
            return;
        }
    }
    
    showSpinner(ui, true);
    ui.saveAllBtn.disabled = true; // Deshabilitar para evitar doble clic
    showStatus(ui, 'Guardando todas las reservas...', 'info');

    const { savedReservationData } = await chrome.storage.local.get('savedReservationData');

    try {
        const prep = await buildReservationsToSaveFromForm(savedReservationData, { validateOrbisRequired: true });
        if (!prep.ok) {
            const missingNumidsucursal = prep.missingNumidsucursal || [];
            showSpinner(ui, false);
            ui.saveAllBtn.disabled = false;
            showStatus(ui, `⚠️ Hay campos obligatorios de ORBISWEB sin completar en la(s) reserva(s): ${missingNumidsucursal.join(', ')}. Por favor, completa todos los campos requeridos.`, 'error');
            scrollPopupToTop(ui);

            const requiredFields = ['strlocalizadorpnr', 'strlocalizadorgds'];
            missingNumidsucursal.forEach(reservationNum => {
                const index = reservationNum - 1;
                PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                    const isRequired = requiredFields.some(rf => field.toLowerCase() === rf.toLowerCase());
                    if (isRequired) {
                        const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                        if (inputElement && inputElement.value.trim() === '') {
                            validateOrbiswebRequiredField(inputElement);
                        }
                    }
                });
            });
            return;
        }
        const reservationsToSave = prep.reservationsToSave;
        const expedienteChoice = await applyOrbisExpedienteCreationChoice(reservationsToSave);
        if (expedienteChoice && expedienteChoice.aborted) {
            showSpinner(ui, false);
            ui.saveAllBtn.disabled = false;
            showStatus(ui, 'Guardado cancelado. Vuelve a pulsar "Guardar todo" cuando estés listo.', 'warning');
            scrollPopupToTop(ui);
            return;
        }

        // Log detallado de lo que se va a enviar al backend (estructura y datos)
        const customSlugs = Array.isArray(window.CUSTOM_SCHEMA) ? window.CUSTOM_SCHEMA.map(cf => cf?.slug).filter(Boolean) : [];
        console.log('[POPUP][ENVÍO] Número de reservas:', reservationsToSave?.length);
        console.log('[POPUP][ENVÍO] Custom fields (slug) esperados:', customSlugs);
        if (reservationsToSave?.length > 0) {
            const first = reservationsToSave[0];
            console.log('[POPUP][ENVÍO] Claves de la primera reserva:', Object.keys(first).sort());
            const customValues = {};
            customSlugs.forEach(slug => { customValues[slug] = first[slug]; });
            console.log('[POPUP][ENVÍO] Valores custom_fields (1ª reserva):', customValues);
            console.log('[POPUP][ENVÍO] Primera reserva (JSON):', JSON.stringify(first, null, 2));
        }
        console.log('[POPUP][ENVÍO] ReservationsData completo que se envía:', reservationsToSave);

        // --- Checklist de progreso en vivo ---------------------------------
        // Generamos un ID único, abrimos el panel y arrancamos polling al
        // endpoint /api/save_all_reservations/progress/<id> mientras el POST
        // principal trabaja. El backend va escribiendo el avance real de cada
        // paso del flujo (validación, procesamiento, guardado, webhook, Orbis).
        const __sp_requestId = _genSaveProgressRequestId();
        showSaveProgressPanel(reservationsToSave.length);
        const __sp_poller = startSaveProgressPolling(apiKey, __sp_requestId, updateSaveProgressFromBackend);

        let response;
        try {
            response = await chrome.runtime.sendMessage({
                action: 'saveAllReservations',
                apiKey: apiKey,
                reservationsData: reservationsToSave,
                requestId: __sp_requestId
            });
        } finally {
            // Damos un margen para un último tick del polling y luego paramos.
            setTimeout(() => __sp_poller.stop(), 600);
        }

        // Si el polling no llegó al estado final, lo pintamos a partir de la
        // respuesta HTTP del POST principal (caso muy rápido).
        finalizeSaveProgressFromResponse(response);
        // Auto-ocultamos el panel a los pocos segundos en caso de éxito.
        if (response && response.status === 'ok') {
            hideSaveProgressPanel(3500);
        }

        if (response.status === 'ok') {
            const isAllOmitted = !!response.all_omitted
                || (response.reservations_saved === 0
                    && response.reservations_omitted > 0);
            if (isAllOmitted) {
                const omittedMsg = response.reservations_omitted === 1
                    ? 'Reserva omitida: ya existe en CapData.'
                    : `${response.reservations_omitted} reservas omitidas: ya existen en CapData.`;
                showStatus(ui, omittedMsg, 'warning');
            } else {
                const successMessage = getGiavAwareSaveSuccessMessage(response.message);
                showStatus(ui, successMessage || response.message, 'success');
            }
            scrollPopupToTop(ui);
            await applySavedLockedState(ui);

        } else {
            const friendlyResult = await showFriendlyOrbisErrorModal(response, { ui, apiKey });
            if (!friendlyResult || friendlyResult.handled !== true) {
                showStatus(ui, `Error: ${response.message}`, 'error');
            } else if (friendlyResult.outcome === 'cancelled') {
                showStatus(
                    ui,
                    'Envío a ORBISWEB cancelado. La reserva está guardada en CapData.',
                    'warning'
                );
            } else if (friendlyResult.outcome === 'retry_failed') {
                showStatus(
                    ui,
                    'El reintento a ORBISWEB falló. La reserva sigue guardada en CapData.',
                    'warning'
                );
            } else if (friendlyResult.outcome === 'info_only') {
                showStatus(
                    ui,
                    'Aviso de ORBISWEB. La reserva está guardada en CapData; revisa la integración.',
                    'warning'
                );
            } else if (friendlyResult.outcome === 'retry_succeeded') {
                // El modal ya pintó "Reserva reenviada correctamente a ORBISWEB" en verde.
                // La reserva está completamente guardada (CapData + Orbis), así que
                // dejamos la UI en el mismo estado final que el guardado directo:
                // formularios bloqueados y botón "Iniciar nueva captura" visible.
                await applySavedLockedState(ui);
            }
            scrollPopupToTop(ui);
            if (!friendlyResult || friendlyResult.outcome !== 'retry_succeeded') {
                ui.saveAllBtn.disabled = false;
            }
        }

    } catch (e) {
        showStatus(ui, `Error de comunicación: ${e.message}`, 'error');
        scrollPopupToTop(ui);
        ui.saveAllBtn.disabled = false;
        // Si el panel de progreso quedó abierto sin estado final, lo cerramos
        // marcándolo como error para que la UI no quede colgada en "Conectando..."
        finalizeSaveProgressFromResponse({ status: 'error', message: e.message || 'Error de comunicación' });
        hideSaveProgressPanel(2500);
    } finally {
        showSpinner(ui, false);
    }
}

function hasOrbisExpedienteValue(reservation) {
    if (!reservation || typeof reservation !== 'object') return false;
    const automation = (reservation.reservation_automation && typeof reservation.reservation_automation === 'object')
        ? reservation.reservation_automation
        : {};
    const candidates = [
        reservation.numIdExpediente,
        reservation.num_id_expediente,
        reservation.id_expediente,
        reservation.expediente_id,
        reservation.codigo_expediente,
        reservation.expediente,
        automation.numIdExpediente,
        automation.codigo_expediente
    ];
    return candidates.some(v => v !== null && v !== undefined && String(v).trim() !== '');
}

async function applyOrbisExpedienteCreationChoice(reservationsToSave) {
    if (!cachedOrbiswebStatus || cachedIntegrationVisibility.orbisweb === false) return;
    if (!Array.isArray(reservationsToSave) || reservationsToSave.length === 0) return;

    const missingExpedienteIndexes = [];
    reservationsToSave.forEach((reservation, idx) => {
        if (!hasOrbisExpedienteValue(reservation)) {
            missingExpedienteIndexes.push(idx);
        }
    });

    if (missingExpedienteIndexes.length === 0) return;

    const totalMissing = missingExpedienteIndexes.length;
    let position = 0;
    // Preguntamos por reserva: si tiene >1 pasajero, el modal incluye el desplegable
    // para elegir el titular del expediente (un servicio por pasajero con billete).
    for (const idx of missingExpedienteIndexes) {
        position += 1;
        const reservation = reservationsToSave[idx] || {};
        const pasajeros = Array.isArray(reservation.pasajeros)
            ? reservation.pasajeros.filter(p => p && typeof p === 'object')
            : [];
        const prefix = totalMissing > 1 ? `Reserva ${position}/${totalMissing}. ` : '';
        const message = pasajeros.length > 1
            ? `${prefix}La reserva tiene ${pasajeros.length} pasajeros. Se creará un servicio por pasajero con billete dentro del mismo expediente. Elige el titular del expediente y confirma para crearlo en Orbis Web.`
            : `${prefix}La reserva no tiene expediente. ¿Deseas crear un expediente nuevo en Orbis Web al guardar?`;

        const choice = await showOrbisExpedienteTitularModal({ message, pasajeros });
        // null = cerró sin decidir (X / overlay / Escape) → abortar TODO el guardado.
        if (choice === null) {
            return { aborted: true };
        }
        const createExpediente = !!(choice && choice.create);
        const nextAccion = createExpediente ? 'volcar_expediente' : 'solo_captura';
        reservation.accion = nextAccion;
        const automation = (reservation.reservation_automation && typeof reservation.reservation_automation === 'object')
            ? { ...reservation.reservation_automation }
            : {};
        automation.accion = nextAccion;
        reservation.reservation_automation = automation;
        if (createExpediente && choice.titular) {
            reservation.orbis_expediente_titular = choice.titular;
        } else if (reservation.orbis_expediente_titular) {
            delete reservation.orbis_expediente_titular;
        }
        reservationsToSave[idx] = reservation;
    }
    return { aborted: false };
}

function showCompactChoiceModal({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar' }) {
    // Valores devueltos:
    //   true  -> botón confirmar (decisión explícita)
    //   false -> botón cancelar  (decisión explícita)
    //   null  -> cerrado con la X o clic fuera (abortar, no decidió)
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10050;padding:12px;';

        const modal = document.createElement('div');
        modal.style.cssText = 'position:relative;width:min(420px,95vw);background:#fff;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:14px 14px 12px 14px;font-family:Arial,sans-serif;';

        const closeX = document.createElement('button');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Cerrar');
        closeX.innerHTML = '&times;';
        closeX.style.cssText = 'position:absolute;top:6px;right:8px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#6b7280;font-size:20px;line-height:1;cursor:pointer;padding:0;border-radius:4px;';
        closeX.addEventListener('mouseover', () => { closeX.style.background = '#f3f4f6'; closeX.style.color = '#111827'; });
        closeX.addEventListener('mouseout', () => { closeX.style.background = 'transparent'; closeX.style.color = '#6b7280'; });

        const h = document.createElement('div');
        h.textContent = title || 'Confirmación';
        h.style.cssText = 'font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;padding-right:24px;';

        const p = document.createElement('div');
        p.textContent = message || '';
        p.style.cssText = 'font-size:13px;line-height:1.4;color:#374151;margin-bottom:12px;';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = cancelText;
        cancelBtn.style.cssText = 'border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;';

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.textContent = confirmText;
        okBtn.style.cssText = 'border:none;background:#2563eb;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;';

        const onKeyDown = (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                closeAndResolve(null);
            }
        };
        const closeAndResolve = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve(value);
        };
        document.addEventListener('keydown', onKeyDown, true);

        closeX.addEventListener('click', () => closeAndResolve(null));
        cancelBtn.addEventListener('click', () => closeAndResolve(false));
        okBtn.addEventListener('click', () => closeAndResolve(true));
        overlay.addEventListener('click', (evt) => {
            if (evt.target === overlay) closeAndResolve(null);
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        modal.appendChild(closeX);
        modal.appendChild(h);
        modal.appendChild(p);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

// Modal de "crear expediente" CON selección de titular cuando hay >1 pasajero.
// Devuelve:
//   null                                  -> cerrado sin decidir (abortar guardado)
//   { create: false }                     -> "No crear"
//   { create: true, titular: null|{...} } -> "Sí, crear" (+ titular elegido)
function showOrbisExpedienteTitularModal({ message, pasajeros = [], confirmText = 'Sí, crear', cancelText = 'No crear' }) {
    const paxList = Array.isArray(pasajeros) ? pasajeros.filter(p => p && typeof p === 'object') : [];
    const paxName = (p) => {
        const parts = [
            String(p.nombre_pax || p.nombre || '').trim(),
            String(p.primer_apellido_pax || p.primer_apellidos_pax || p.apellido1 || '').trim(),
            String(p.segundo_apellido_pax || p.apellido2 || '').trim(),
        ];
        return parts.filter(Boolean).join(' ').trim();
    };
    const paxNif = (p) => String(p.nif || p.documento || p.dni || p.pasaporte_numero || '').trim();
    const multi = paxList.length > 1;

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10050;padding:12px;';
        const modal = document.createElement('div');
        modal.style.cssText = 'position:relative;width:min(440px,95vw);background:#fff;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:14px 14px 12px 14px;font-family:Arial,sans-serif;';

        const closeX = document.createElement('button');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Cerrar');
        closeX.innerHTML = '&times;';
        closeX.style.cssText = 'position:absolute;top:6px;right:8px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#6b7280;font-size:20px;line-height:1;cursor:pointer;padding:0;border-radius:4px;';

        const h = document.createElement('div');
        h.textContent = 'Crear expediente en Orbis Web';
        h.style.cssText = 'font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;padding-right:24px;';

        const p = document.createElement('div');
        p.textContent = message || '';
        p.style.cssText = 'font-size:13px;line-height:1.4;color:#374151;margin-bottom:12px;';

        // --- Selección de titular (solo si hay >1 pasajero) ---
        const titularWrap = document.createElement('div');
        let select = null, otroNombre = null, nifInput = null, errEl = null;
        if (multi) {
            titularWrap.style.cssText = 'margin-bottom:12px;display:flex;flex-direction:column;gap:6px;';
            const lbl = document.createElement('label');
            lbl.textContent = 'Titular del expediente';
            lbl.style.cssText = 'font-size:12px;font-weight:600;color:#111827;';
            select = document.createElement('select');
            select.style.cssText = 'width:100%;box-sizing:border-box;padding:7px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;';
            paxList.forEach((pax, i) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                const nm = paxName(pax) || `Pasajero ${i + 1}`;
                opt.textContent = paxNif(pax) ? nm : `${nm} (sin NIF)`;
                select.appendChild(opt);
            });
            const optOtro = document.createElement('option');
            optOtro.value = '__otro__';
            optOtro.textContent = 'Otro contacto…';
            select.appendChild(optOtro);
            const firstWithNif = paxList.findIndex(pp => paxNif(pp));
            select.value = String(firstWithNif >= 0 ? firstWithNif : 0);

            otroNombre = document.createElement('input');
            otroNombre.type = 'text';
            otroNombre.placeholder = 'Nombre del titular';
            otroNombre.style.cssText = 'width:100%;box-sizing:border-box;padding:7px 30px 7px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;';
            // Spinner DENTRO del input mientras busca el NIF (keyframes propio para no
            // depender del CSS de la página).
            if (!document.getElementById('orbis-spin-style')) {
                const _st = document.createElement('style');
                _st.id = 'orbis-spin-style';
                _st.textContent = '@keyframes orbisspin{from{transform:translateY(-50%) rotate(0deg)}to{transform:translateY(-50%) rotate(360deg)}}';
                (document.head || document.documentElement).appendChild(_st);
            }
            const otroNombreWrap = document.createElement('div');
            otroNombreWrap.style.cssText = 'position:relative;display:none;';
            const otroSpinner = document.createElement('div');
            otroSpinner.style.cssText = 'position:absolute;right:9px;top:50%;width:14px;height:14px;border:2px solid #d1d5db;border-top-color:#2563eb;border-radius:50%;display:none;animation:orbisspin 0.8s linear infinite;';
            otroNombreWrap.appendChild(otroNombre);
            otroNombreWrap.appendChild(otroSpinner);

            const nifLbl = document.createElement('label');
            nifLbl.textContent = 'NIF del titular';
            nifLbl.style.cssText = 'font-size:12px;font-weight:600;color:#111827;margin-top:2px;';
            nifInput = document.createElement('input');
            nifInput.type = 'text';
            nifInput.placeholder = 'NIF / CIF del titular';
            nifInput.style.cssText = 'width:100%;box-sizing:border-box;padding:7px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;';

            const otroStatus = document.createElement('div');
            otroStatus.style.cssText = 'font-size:11px;color:#6b7280;min-height:13px;';

            errEl = document.createElement('div');
            errEl.style.cssText = 'color:#b91c1c;font-size:12px;min-height:14px;';

            const syncFromSelect = () => {
                if (select.value === '__otro__') {
                    otroNombreWrap.style.display = 'block';
                    nifInput.value = '';
                    otroStatus.textContent = '';
                    setTimeout(() => otroNombre.focus(), 30);
                } else {
                    otroNombreWrap.style.display = 'none';
                    otroStatus.textContent = '';
                    const pax = paxList[parseInt(select.value, 10)] || {};
                    nifInput.value = paxNif(pax);
                }
                errEl.textContent = '';
            };
            select.addEventListener('change', syncFromSelect);

            // Búsqueda automática del NIF en CapData por NOMBRE (match exacto):
            // spinner dentro del input + mensaje según el resultado.
            let otroLookupSeq = 0;
            const runOtroLookup = async (name) => {
                const seq = ++otroLookupSeq;
                otroSpinner.style.display = 'block';
                otroStatus.style.color = '#6b7280';
                otroStatus.textContent = 'Buscando DNI en CapData…';
                let resp = null;
                try {
                    const apiKey = await _orbisGetApiKey();
                    if (!apiKey) {
                        if (seq === otroLookupSeq) { otroSpinner.style.display = 'none'; otroStatus.style.color = '#b91c1c'; otroStatus.textContent = 'Falta la API Key.'; }
                        return;
                    }
                    resp = await Promise.race([
                        chrome.runtime.sendMessage({ action: 'lookupPassengerNif', apiKey, name }),
                        new Promise((res) => setTimeout(() => res({ status: 'timeout' }), 12000)),
                    ]);
                } catch (_) { resp = { status: 'error' }; }
                if (seq !== otroLookupSeq) return; // ya hay una búsqueda más reciente
                otroSpinner.style.display = 'none';
                if (resp && resp.status === 'success' && resp.nif) {
                    nifInput.value = resp.nif;
                    otroStatus.style.color = '#15803d';
                    otroStatus.textContent = '✓ NIF encontrado en CapData.';
                } else if (resp && resp.status === 'timeout') {
                    otroStatus.style.color = '#b91c1c';
                    otroStatus.textContent = 'La búsqueda tardó demasiado; escribe el NIF manualmente.';
                } else {
                    otroStatus.style.color = '#92400e';
                    otroStatus.textContent = 'No tenemos el NIF en CapData; escríbelo manualmente.';
                }
            };
            otroNombre.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); const n = otroNombre.value.trim(); if (n) runOtroLookup(n); }
            });
            let otroTimer = null;
            otroNombre.addEventListener('input', () => {
                otroStatus.textContent = '';
                otroSpinner.style.display = 'none';
                otroLookupSeq++; // invalida cualquier búsqueda en curso
                if (otroTimer) clearTimeout(otroTimer);
                const n = otroNombre.value.trim();
                if (!n) return;
                otroTimer = setTimeout(() => { if (!nifInput.value.trim()) runOtroLookup(n); }, 600);
            });

            titularWrap.appendChild(lbl);
            titularWrap.appendChild(select);
            titularWrap.appendChild(otroNombreWrap);
            titularWrap.appendChild(nifLbl);
            titularWrap.appendChild(nifInput);
            titularWrap.appendChild(otroStatus);
            titularWrap.appendChild(errEl);
            // El <select> nativo no se abre bien en la UI inyectada: lo convertimos
            // en el desplegable custom que sí funciona (botón + menú).
            if (typeof enhanceSelectWithFixedDropdown === 'function') {
                enhanceSelectWithFixedDropdown(select);
            }
            setTimeout(syncFromSelect, 0);
        }

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = cancelText;
        cancelBtn.style.cssText = 'border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;';
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.textContent = confirmText;
        okBtn.style.cssText = 'border:none;background:#2563eb;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;';

        const onKeyDown = (evt) => {
            if (evt.key === 'Escape') { evt.preventDefault(); closeAndResolve(null); }
        };
        const closeAndResolve = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve(value);
        };
        document.addEventListener('keydown', onKeyDown, true);

        closeX.addEventListener('click', () => closeAndResolve(null));
        cancelBtn.addEventListener('click', () => closeAndResolve({ create: false }));
        overlay.addEventListener('click', (evt) => { if (evt.target === overlay) closeAndResolve(null); });

        okBtn.addEventListener('click', async () => {
            if (!multi) { closeAndResolve({ create: true, titular: null }); return; }
            const sel = select.value;
            let nif = nifInput.value.trim();
            if (sel === '__otro__') {
                const nombre = otroNombre.value.trim();
                if (!nombre) { errEl.textContent = 'Introduce el nombre del titular.'; otroNombre.focus(); return; }
                if (!nif) {
                    try {
                        const apiKey = await _orbisGetApiKey();
                        if (apiKey) {
                            const resp = await chrome.runtime.sendMessage({ action: 'lookupPassengerNif', apiKey, name: nombre });
                            if (resp && resp.status === 'success' && resp.nif) { nif = resp.nif; nifInput.value = nif; }
                        }
                    } catch (_) { /* silencioso */ }
                }
                if (!nif) { errEl.textContent = 'Introduce el NIF del titular.'; nifInput.focus(); return; }
                closeAndResolve({ create: true, titular: { tipo: 'otro', nombre, nif } });
                return;
            }
            const idx = parseInt(sel, 10);
            const nombre = paxName(paxList[idx] || {});
            if (!nif) { errEl.textContent = 'El titular necesita NIF. Introdúcelo.'; nifInput.focus(); return; }
            closeAndResolve({ create: true, titular: { tipo: 'pasajero', pax_index: idx, nombre, nif } });
        });

        modal.appendChild(closeX);
        modal.appendChild(h);
        modal.appendChild(p);
        if (multi) modal.appendChild(titularWrap);
        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
}

function showCompactInfoModal({ title, message, hints = [] }) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10051;padding:12px;';

    const modal = document.createElement('div');
    modal.style.cssText = 'width:min(500px,95vw);background:#fff;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:14px;font-family:Arial,sans-serif;';

    const h = document.createElement('div');
    h.textContent = title || 'Información';
    h.style.cssText = 'font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;';

    const p = document.createElement('div');
    p.textContent = message || '';
    p.style.cssText = 'font-size:13px;line-height:1.4;color:#374151;margin-bottom:10px;white-space:pre-wrap;';
    modal.appendChild(h);
    modal.appendChild(p);

    if (Array.isArray(hints) && hints.length > 0) {
        const tipsTitle = document.createElement('div');
        tipsTitle.textContent = 'Qué puedes hacer ahora:';
        tipsTitle.style.cssText = 'font-size:12px;font-weight:700;color:#111827;margin-bottom:6px;';
        modal.appendChild(tipsTitle);

        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:0 0 12px 18px;padding:0;color:#374151;font-size:12px;line-height:1.45;';
        hints.forEach((hint) => {
            const li = document.createElement('li');
            li.textContent = hint;
            ul.appendChild(li);
        });
        modal.appendChild(ul);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Entendido';
    closeBtn.style.cssText = 'border:none;background:#2563eb;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;';
    actions.appendChild(closeBtn);
    modal.appendChild(actions);

    const closeModal = () => overlay.remove();
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) closeModal();
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function showOrbisProviderRetryModal({
    title = 'Reintentar envío a Orbis',
    message = '',
    attemptedProviderId = null,
    allowSkip = true,
    submitLabel = 'Reintentar con este proveedor',
    skipLabel = 'Enviar sin proveedor',
    cancelLabel = 'Cancelar',
    previousErrorMessage = '',
    createdNumIdExpediente = null,
    savedNote = ''
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10052;padding:12px;';

        const modal = document.createElement('div');
        modal.style.cssText = 'width:min(460px,95vw);background:#fff;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:16px;font-family:Arial,sans-serif;';

        const h = document.createElement('div');
        h.textContent = title;
        h.style.cssText = 'font-size:15px;font-weight:700;color:#111827;margin-bottom:8px;';
        modal.appendChild(h);

        if (createdNumIdExpediente != null) {
            const expInfo = document.createElement('div');
            expInfo.textContent = `Expediente ya creado en Orbis: numIdExpediente ${createdNumIdExpediente}.`;
            expInfo.style.cssText = 'font-size:14px;line-height:1.4;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;margin-bottom:10px;font-weight:700;';
            modal.appendChild(expInfo);
        }

        if (previousErrorMessage) {
            const lastError = document.createElement('div');
            lastError.textContent = `Último intento: ${previousErrorMessage}`;
            lastError.style.cssText = 'font-size:12px;line-height:1.4;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px;margin-bottom:10px;white-space:pre-wrap;';
            modal.appendChild(lastError);
        }

        if (message) {
            const p = document.createElement('div');
            p.textContent = message;
            p.style.cssText = 'font-size:13px;line-height:1.4;color:#374151;margin-bottom:12px;white-space:pre-wrap;';
            modal.appendChild(p);
        }

        const label = document.createElement('label');
        label.textContent = 'numIdProveedor de Orbis';
        label.style.cssText = 'display:block;font-size:12px;font-weight:600;color:#111827;margin-bottom:4px;';
        modal.appendChild(label);

        // Fila input + botón principal (input 3/4, botón 1/4)
        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;gap:8px;align-items:stretch;margin-bottom:4px;';

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.step = '1';
        input.inputMode = 'numeric';
        input.placeholder = 'Ej. 13';
        input.style.cssText = 'flex:3;min-width:0;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font-size:13px;color:#111827;';
        if (attemptedProviderId != null) {
            input.value = String(attemptedProviderId);
        }
        inputRow.appendChild(input);

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.textContent = submitLabel;
        okBtn.style.cssText = 'flex:1;min-width:0;border:none;background:#2563eb;color:#fff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;text-align:center;line-height:1.2;white-space:normal;word-break:break-word;';
        inputRow.appendChild(okBtn);

        modal.appendChild(inputRow);

        const helper = document.createElement('div');
        helper.textContent = attemptedProviderId
            ? `Se intentó con numIdProveedor=${attemptedProviderId}. Cambia el valor y reintenta.`
            : 'Introduce el ID numérico exacto del proveedor en Orbis y reintenta.';
        helper.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:12px;';
        modal.appendChild(helper);

        const errorBox = document.createElement('div');
        errorBox.style.cssText = 'display:none;font-size:12px;color:#b91c1c;margin-bottom:8px;';
        modal.appendChild(errorBox);

        if (savedNote) {
            const savedNoteBox = document.createElement('div');
            savedNoteBox.textContent = savedNote;
            savedNoteBox.style.cssText = 'font-size:12px;line-height:1.4;color:#374151;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:8px;margin-bottom:10px;';
            modal.appendChild(savedNoteBox);
        }

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;';

        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.textContent = skipLabel;
        skipBtn.style.cssText = 'border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:600;';
        if (!allowSkip) skipBtn.style.display = 'none';

        if (allowSkip) actions.appendChild(skipBtn);
        modal.appendChild(actions);

        // Cancelación: clic fuera del modal (overlay) o tecla Escape.
        const onKeyDown = (evt) => {
            if (evt.key === 'Escape') {
                evt.preventDefault();
                close({ action: 'cancel' });
            }
        };
        const close = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve(value);
        };
        document.addEventListener('keydown', onKeyDown, true);

        skipBtn.addEventListener('click', () => close({ action: 'retry-without-provider' }));
        okBtn.addEventListener('click', () => {
            const raw = String(input.value || '').trim();
            const asNumber = Number(raw);
            if (!raw || !Number.isFinite(asNumber) || asNumber <= 0 || !Number.isInteger(asNumber)) {
                errorBox.textContent = 'Introduce un numIdProveedor numérico válido (entero positivo).';
                errorBox.style.display = 'block';
                input.focus();
                return;
            }
            close({ action: 'retry-with-provider', providerId: asNumber });
        });
        overlay.addEventListener('click', (evt) => {
            if (evt.target === overlay) close({ action: 'cancel' });
        });
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                okBtn.click();
            }
        });

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setTimeout(() => input.focus(), 50);
    });
}

async function performOrbisRetrySend({ requestLogId, providerId = null, skipProvider = false, createExpediente = false, nif = null, pnrOnly = false, apiKey, employeeToken = null }) {
    if (!requestLogId) {
        return { status: 'error', message: 'Falta request_log_id para reintentar.' };
    }
    try {
        const body = {
            request_log_id: requestLogId,
            api_key: apiKey || '',
        };
        if (employeeToken) body.employee_token = employeeToken;
        if (skipProvider) {
            body.skip_num_id_proveedor = true;
        } else if (providerId != null) {
            body.num_id_proveedor = providerId;
        }
        if (createExpediente) body.create_expediente = true;
        if (pnrOnly) body.pnr_only = true;
        if (nif) body.nif = nif;
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['X-API-Key'] = apiKey;
        if (employeeToken) headers['X-Employee-Token'] = employeeToken;
        const url = `${POPUP_API_BASE_URL}/api/orbis/retry-send`;
        const tStart = performance.now();
        console.log('[ORBIS RETRY] -> POST', url, 'body=', { ...body, api_key: body.api_key ? '***' : '' });
        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        const tFetchDone = performance.now();
        const rawText = await resp.text();
        console.log('[ORBIS RETRY] <- HTTP', resp.status, `(${Math.round(tFetchDone - tStart)}ms)`, 'bodyPreview=', rawText.slice(0, 500));
        let data = null;
        try { data = rawText ? JSON.parse(rawText) : null; } catch (_) { data = null; }
        if (!data) {
            return {
                status: 'error',
                message: `Respuesta inválida del servidor (HTTP ${resp.status}). Cuerpo: ${rawText.slice(0, 200) || '(vacío)'}`,
            };
        }
        return data;
    } catch (e) {
        console.error('[ORBIS RETRY] EXCEPTION', e);
        return { status: 'error', message: `Error de red al reintentar: ${e?.message || e}` };
    }
}

function showOrbisNifPromptModal({ message, previousError = '' } = {}) {
    // Pide el NIF del viajero cuando Orbis no pudo identificar al cliente (el
    // contacto no tenía NIF). Devuelve el NIF (string) o null si se cancela.
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:10060;padding:12px;';
        const modal = document.createElement('div');
        modal.style.cssText = 'position:relative;width:min(420px,95vw);background:#fff;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.2);padding:16px;font-family:Arial,sans-serif;';
        const title = document.createElement('div');
        title.textContent = 'Falta el NIF del viajero';
        title.style.cssText = 'font-weight:bold;font-size:15px;margin-bottom:8px;color:#111827;';
        const msg = document.createElement('div');
        msg.textContent = message || 'Orbis necesita el NIF del viajero para crear el servicio bajo ese cliente. Introdúcelo:';
        msg.style.cssText = 'font-size:13px;color:#374151;margin-bottom:10px;white-space:pre-line;';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'NIF / DNI / NIE del viajero';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;margin-bottom:6px;';
        const err = document.createElement('div');
        err.textContent = previousError || '';
        err.style.cssText = 'color:#b91c1c;font-size:12px;min-height:14px;margin-bottom:8px;';
        const rowBtns = document.createElement('div');
        rowBtns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.textContent = 'Cancelar';
        cancel.style.cssText = 'padding:8px 12px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:6px;cursor:pointer;';
        const ok = document.createElement('button');
        ok.type = 'button'; ok.textContent = 'Enviar con este NIF';
        ok.style.cssText = 'padding:8px 12px;border:none;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer;';
        const pnrBtn = document.createElement('button');
        pnrBtn.type = 'button'; pnrBtn.textContent = 'Continuar solo PNR';
        pnrBtn.title = 'Sin NIF no se puede crear servicio/expediente: registra solo la línea PNR en Orbis';
        pnrBtn.style.cssText = 'padding:8px 12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:6px;cursor:pointer;';
        const close = (val) => { try { document.body.removeChild(overlay); } catch (_) {} resolve(val); };
        cancel.addEventListener('click', () => close(null));
        pnrBtn.addEventListener('click', () => close({ pnrOnly: true }));
        ok.addEventListener('click', () => {
            const v = input.value.trim();
            if (v) close(v); else { err.textContent = 'Introduce un NIF.'; }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') ok.click();
            if (e.key === 'Escape') close(null);
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        rowBtns.appendChild(cancel); rowBtns.appendChild(pnrBtn); rowBtns.appendChild(ok);
        modal.appendChild(title); modal.appendChild(msg); modal.appendChild(input); modal.appendChild(err); modal.appendChild(rowBtns);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setTimeout(() => input.focus(), 50);
    });
}

async function showFriendlyOrbisErrorModal(responseOrMessage, context = {}) {
    const HANDLED_CANCELLED = { handled: true, outcome: 'cancelled' };
    const HANDLED_RETRY_OK = { handled: true, outcome: 'retry_succeeded' };
    const HANDLED_RETRY_FAILED = { handled: true, outcome: 'retry_failed' };
    const HANDLED_INFO = { handled: true, outcome: 'info_only' };

    let rawMessage = '';
    let errorCode = '';
    let orbisErrorText = '';
    let attemptedProviderId = null;
    let savedLocally = false;
    let requestLogId = null;
    let retrySupported = false;
    let expedienteAttempted = false;

    let createdNumIdExpediente = null;
    if (responseOrMessage && typeof responseOrMessage === 'object') {
        rawMessage = responseOrMessage.message || '';
        errorCode = responseOrMessage.error_code || '';
        orbisErrorText = responseOrMessage.orbis_error || '';
        attemptedProviderId = responseOrMessage.attempted_num_id_proveedor ?? null;
        savedLocally = !!responseOrMessage.reservation_saved_locally;
        requestLogId = responseOrMessage.request_log_id ?? null;
        retrySupported = !!responseOrMessage.orbis_retry_supported;
        expedienteAttempted = !!responseOrMessage.orbis_create_expediente_attempted;
        createdNumIdExpediente = responseOrMessage.created_num_id_expediente ?? null;
    } else {
        rawMessage = String(responseOrMessage || '');
    }

    const text = String(rawMessage || '').trim();
    if (!text && !errorCode) return false;

    const lower = (text + ' ' + (orbisErrorText || '')).toLowerCase();
    const isOrbisContext = errorCode.startsWith('orbis_')
        || lower.includes('orbis')
        || lower.includes('proveedor')
        || lower.includes('expediente');
    if (!isOrbisContext) return false;

    const savedNote = savedLocally
        ? 'La reserva sí se guardó correctamente en CapData; solo falló el envío a ORBISWEB.'
        : null;

    const ui = context.ui || null;
    const apiKey = context.apiKey || (ui && ui.apiKeyInput ? ui.apiKeyInput.value.trim() : '');

    const providerErrorCodes = new Set([
        'orbis_capture_provider_invalid',
        'orbis_capture_failed',
        'orbis_expediente_provider_invalid',
        'orbis_expediente_provider_missing',
        'orbis_expediente_create_failed',
    ]);
    const canOfferRetry = retrySupported && requestLogId && providerErrorCodes.has(errorCode);

    // Falta el NIF del viajero -> pedirlo y reenviar con él (bucle hasta que se
    // acepte o el usuario cancele).
    if (errorCode === 'orbis_missing_nif' && requestLogId) {
        let employeeToken = null;
        try {
            const stored = await chrome.storage.local.get('employeeToken');
            employeeToken = stored?.employeeToken || null;
        } catch (_) { employeeToken = null; }
        let prevErr = '';
        while (true) {
            const result = await showOrbisNifPromptModal({
                message: (text || 'Orbis necesita el NIF del viajero para crear el servicio/expediente.')
                    + '\n\nSin NIF no se puede crear servicio ni expediente: puedes continuar registrando solo la línea PNR.'
                    + (savedNote ? '\n\n' + savedNote : ''),
                previousError: prevErr,
            });
            if (!result) return HANDLED_CANCELLED;
            // "Continuar solo PNR": registrar solo la línea PNR (sin servicio/expediente).
            if (typeof result === 'object' && result.pnrOnly) {
                if (ui) showStatus(ui, 'Registrando solo la línea PNR en ORBISWEB...', 'info');
                const pnrResp = await performOrbisRetrySend({ requestLogId, pnrOnly: true, apiKey, employeeToken });
                if (pnrResp?.status === 'ok') {
                    markSaveProgressRetrySucceeded('PNR registrado en ORBISWEB (sin servicio: falta NIF).');
                    showCompactInfoModal({
                        title: 'PNR registrado (sin servicio)',
                        message: pnrResp.message || 'Sin NIF no se pudo crear servicio/expediente: se registró solo la línea PNR en ORBISWEB.',
                        hints: []
                    });
                    if (ui) showStatus(ui, 'PNR registrado en ORBISWEB (sin servicio).', 'success');
                    return HANDLED_RETRY_OK;
                }
                prevErr = pnrResp?.message || 'No se pudo registrar la línea PNR.';
                continue;
            }
            const nif = result;
            if (ui) showStatus(ui, 'Reenviando a ORBISWEB con el NIF...', 'info');
            const retryResp = await performOrbisRetrySend({ requestLogId, nif, apiKey, employeeToken });
            if (retryResp?.status === 'ok') {
                markSaveProgressRetrySucceeded('Servicio añadido a ORBISWEB con el NIF del viajero.');
                showCompactInfoModal({
                    title: 'Enviado a ORBISWEB',
                    message: 'El servicio se añadió al expediente con el NIF del viajero.',
                    hints: []
                });
                if (ui) showStatus(ui, 'Servicio añadido a ORBISWEB.', 'success');
                return HANDLED_RETRY_OK;
            }
            prevErr = retryResp?.message || 'No se pudo enviar con ese NIF. Revísalo e inténtalo de nuevo.';
        }
    }

    if (canOfferRetry) {
        const providerSuffix = attemptedProviderId ? ` (numIdProveedor intentado: ${attemptedProviderId})` : '';
        // Distinguimos 3 escenarios para que la UI sea coherente:
        // 1) Quisimos crear expediente y SE CREÓ, pero Orbis rechazó el proveedor
        //    de la línea de reserva  → el problema es el proveedor, no el expediente.
        // 2) Quisimos crear expediente pero NO se creó (no tenemos numIdExpediente).
        // 3) No quisimos crear expediente; falló el envío de la captura.
        const expedienteAlreadyCreated = expedienteAttempted && createdNumIdExpediente != null;
        let retryTitle;
        let baseMessage;
        let retryWithProviderLabel;
        let skipLabel;
        if (expedienteAlreadyCreated) {
            retryTitle = 'Falta proveedor para el servicio';
            baseMessage = `Orbis rechazó el proveedor${providerSuffix}, por eso el servicio no se añadió al expediente.\n\n`
                + 'Sin proveedor NO se puede crear el servicio. Introduce un numIdProveedor válido '
                + 'para añadir el servicio al expediente, o continúa sin proveedor: se registrará '
                + 'solo la línea PNR en Orbis (sin servicio).';
            retryWithProviderLabel = 'Añadir servicio con este proveedor';
            skipLabel = 'Continuar sin proveedor (solo PNR)';
        } else if (expedienteAttempted) {
            retryTitle = 'Falta proveedor para crear el expediente';
            baseMessage = `No se pudo crear el expediente en ORBISWEB${providerSuffix}.\n\n`
                + 'Sin proveedor NO se puede crear el expediente ni el servicio. '
                + 'Introduce el numIdProveedor de Orbis y reintentamos creándolo, '
                + 'o continúa sin proveedor: se registrará solo la línea PNR en Orbis (sin expediente ni servicio).';
            retryWithProviderLabel = 'Reintentar y crear expediente';
            // "Continuar sin proveedor" -> NO se crea expediente ni servicio; solo PNR.
            skipLabel = 'Continuar sin proveedor (solo PNR)';
        } else {
            retryTitle = 'No se envió la reserva a Orbis';
            baseMessage = `ORBISWEB rechazó el envío${providerSuffix}.\n\n`
                + 'Si conoces el numIdProveedor de Orbis, introdúcelo abajo y reintentamos. '
                + 'O continúa sin proveedor: se registrará solo la línea PNR en Orbis (sin servicio).';
            retryWithProviderLabel = 'Reintentar con este proveedor';
            skipLabel = 'Continuar sin proveedor (solo PNR)';
        }

        let employeeToken = null;
        try {
            const stored = await chrome.storage.local.get('employeeToken');
            employeeToken = stored?.employeeToken || null;
        } catch (_) { employeeToken = null; }

        let lastOutcome = HANDLED_CANCELLED;
        let previousErrorMessage = '';
        let keepOpen = true;
        while (keepOpen) {
            const choice = await showOrbisProviderRetryModal({
                title: retryTitle,
                message: baseMessage,
                attemptedProviderId,
                allowSkip: true,
                submitLabel: retryWithProviderLabel,
                skipLabel,
                previousErrorMessage,
                createdNumIdExpediente,
                savedNote: savedNote || '',
            });
            if (!choice || choice.action === 'cancel') {
                lastOutcome = HANDLED_CANCELLED;
                keepOpen = false;
                break;
            }
            const skipProvider = choice.action === 'retry-without-provider';
            const providerId = choice.action === 'retry-with-provider' ? choice.providerId : null;
            // Si el usuario quiso crear expediente, lo seguimos intentando SOLO si hay
            // proveedor: "continuar sin proveedor" no crea expediente ni servicio (solo PNR).
            const createExp = expedienteAttempted && !skipProvider;

            if (ui) showStatus(ui, 'Reintentando envío a ORBISWEB...', 'info');
            const retryResp = await performOrbisRetrySend({
                requestLogId,
                providerId,
                skipProvider,
                createExpediente: createExp,
                apiKey,
                employeeToken,
            });
            if (retryResp?.status === 'ok') {
                const pnrOnly = !!retryResp.pnr_only_no_service;
                markSaveProgressRetrySucceeded(
                    pnrOnly
                        ? 'PNR registrado en ORBISWEB (sin servicio: falta proveedor).'
                        : 'Reserva reenviada correctamente a ORBISWEB.'
                );
                const expedienteSuffix = retryResp.created_num_id_expediente
                    ? ` Expediente creado: ${retryResp.created_num_id_expediente}.`
                    : '';
                showCompactInfoModal({
                    title: pnrOnly ? 'PNR registrado (sin servicio)' : 'Reenviada a ORBISWEB',
                    message: pnrOnly
                        ? (retryResp.message || 'Sin proveedor no se pudo crear el servicio: se registró solo la línea de captura (PNR) en ORBISWEB. Asigna un proveedor válido para añadir el servicio.')
                        : skipProvider
                            ? 'La reserva se reenvió correctamente a ORBISWEB sin proveedor.'
                            : `La reserva se reenvió correctamente a ORBISWEB con numIdProveedor=${retryResp.used_num_id_proveedor ?? providerId}.${expedienteSuffix}`,
                    hints: []
                });
                if (ui) showStatus(ui, pnrOnly ? 'PNR registrado en ORBISWEB (sin servicio).' : 'Reserva reenviada correctamente a ORBISWEB.', 'success');
                return HANDLED_RETRY_OK;
            }
            attemptedProviderId = retryResp?.attempted_num_id_proveedor ?? providerId ?? attemptedProviderId;
            if (retryResp?.created_num_id_expediente != null) {
                createdNumIdExpediente = retryResp.created_num_id_expediente;
            }
            previousErrorMessage = retryResp?.message || 'Reintento fallido.';
            lastOutcome = HANDLED_RETRY_FAILED;
            // Volvemos al inicio del bucle; el siguiente modal mostrará el error inline
            // (no abrimos un modal informativo encima para evitar solapar dos modales).
        }
        return lastOutcome;
    }

    if (errorCode === 'orbis_capture_provider_invalid'
        || (errorCode === '' && savedLocally && (lower.includes('proveedor no existe') || lower.includes('inactivo')))) {
        const providerSuffix = attemptedProviderId ? ` (numIdProveedor=${attemptedProviderId})` : '';
        showCompactInfoModal({
            title: 'No se envió la reserva a Orbis',
            message: `ORBISWEB rechazó el proveedor${providerSuffix}: no existe o está inactivo.${savedNote ? '\n\n' + savedNote : ''}`,
            hints: [
                'Revisa en ORBIS que el proveedor exista y esté activo.',
                'Valida el mapeo de proveedor en CapData (numIdProveedor correcto).',
                'Después vuelve a guardar la reserva.'
            ]
        });
        return HANDLED_INFO;
    }

    if (errorCode === 'orbis_expediente_provider_missing') {
        showCompactInfoModal({
            title: 'Falta proveedor de Orbis',
            message: text || 'La reserva no tiene un numIdProveedor de ORBIS válido para crear expediente.',
            hints: [
                'Configura el mapeo de proveedor en CapData (Directorio de proveedores).',
                'Tras corregirlo, vuelve a guardar la reserva.'
            ]
        });
        return HANDLED_INFO;
    }

    if (errorCode === 'orbis_expediente_provider_invalid'
        || (errorCode === '' && (lower.includes('proveedor no existe') || (lower.includes('proveedor') && lower.includes('inactivo'))))) {
        showCompactInfoModal({
            title: 'No se pudo crear el expediente en Orbis',
            message: 'Orbis rechazó el proveedor de la reserva (no existe o está inactivo), por eso no se pudo crear el expediente.',
            hints: [
                'Revisa en Orbis que el proveedor esté activo.',
                'Valida el mapeo de proveedor en CapData (numIdProveedor correcto).',
                'Como alternativa, guarda sin crear expediente y vincúlalo después manualmente.'
            ]
        });
        return HANDLED_INFO;
    }

    if (lower.includes('numidsucursal')) {
        showCompactInfoModal({
            title: 'Falta configuración de Orbis',
            message: 'No se pudo enviar por ORBISWEB porque falta numIdSucursal.',
            hints: [
                'Configura numIdSucursal en la integración Orbis del cliente.',
                'Después vuelve a guardar la reserva.'
            ]
        });
        return HANDLED_INFO;
    }

    if (errorCode === 'orbis_capture_failed' || (errorCode === '' && savedLocally)) {
        showCompactInfoModal({
            title: 'No se envió la reserva a Orbis',
            message: `${text || 'Fallo en el envío a ORBISWEB.'}${savedNote ? '\n\n' + savedNote : ''}`,
            hints: [
                'Revisa la configuración de la integración ORBISWEB.',
                'Corrige el problema indicado y vuelve a guardar la reserva.'
            ]
        });
        return HANDLED_INFO;
    }

    if (errorCode === 'orbis_expediente_create_failed' || lower.includes('expediente')) {
        showCompactInfoModal({
            title: 'Error al crear expediente en Orbis',
            message: text,
            hints: [
                'Revisa los campos obligatorios de expediente en Orbis.',
                'Si prefieres, guarda sin crear expediente y vincúlalo después manualmente.'
            ]
        });
        return HANDLED_INFO;
    }

    return false;
}

function scrollPopupToTop(ui) {
    const scrollTargets = [
        ui?.formContainer,
        document.scrollingElement,
        document.documentElement,
        document.body
    ];

    scrollTargets.forEach((target) => {
        if (!target) return;
        if (typeof target.scrollTo === 'function') {
            target.scrollTo({ top: 0, behavior: 'auto' });
        } else {
            target.scrollTop = 0;
        }
    });
}

function lockCapturedFormFields(ui) {
    if (!ui?.standardFieldsContainer) return;

    ui.standardFieldsContainer
        .querySelectorAll('input, select, textarea')
        .forEach((field) => {
            field.disabled = true;
        });
    // Los <select> mejorados se manejan con un botón "trigger" (capdata-select-trigger);
    // deshabilitarlo también para que no se pueda cambiar el valor tras guardar.
    ui.standardFieldsContainer
        .querySelectorAll('.capdata-select-trigger')
        .forEach((btn) => {
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
            btn.style.opacity = '0.6';
        });
}

async function applySavedLockedState(ui) {
    // Estado final tras guardar la reserva (con o sin reintento a Orbis):
    // bloqueamos los formularios y mostramos solo "Iniciar nueva captura".
    isLastCaptureSavedLocked = true;
    try {
        await chrome.storage.local.set({
            [CAPTURE_VIEW_STATE_KEY]: {
                mode: 'saved_locked',
                updatedAt: Date.now()
            }
        });
    } catch (_) { /* noop */ }
    if (!ui) return;
    lockCapturedFormFields(ui);
    if (ui.saveAllBtn) ui.saveAllBtn.style.display = 'none';
    if (ui.discardBtn) ui.discardBtn.style.display = 'none';
    if (ui.clearBtn) ui.clearBtn.style.display = 'inline-block';
    document.querySelectorAll('.view-payload-btn').forEach(btn => {
        btn.disabled = false;
        btn.title = "Ver todos los campos que se enviarán al backend";
    });
}

async function buildReservationsToSaveFromForm(savedReservationData, options = {}) {
    const validateOrbisRequired = options.validateOrbisRequired !== false;

    // Captura los datos actuales que hay en inputs (visibles y no visibles).
    let reservationsToSave = [];
    if (savedReservationData) {
        for (let i = 0; i < savedReservationData.length; i++) {
            const freshData = await collectSingleFieldData(i);
            reservationsToSave.push(freshData);
        }
    }

    // Asegurar que cada reserva tenga reservation_type y num_pax como entero.
    if (reservationsToSave) {
        reservationsToSave = reservationsToSave.map((reservation) => {
            const reservationData = { ...reservation };
            if (!reservationData.reservation_type) {
                reservationData.reservation_type = selectedReservationType || reservation.reservation_type || 'aereo';
            }

            if (reservationData.pasajeros && Array.isArray(reservationData.pasajeros)) {
                reservationData.num_pax = parseInt(reservationData.pasajeros.length) || 0;
            } else if (reservationData.num_pasajeros) {
                reservationData.num_pax = parseInt(reservationData.num_pasajeros) || 0;
                reservationData.num_pasajeros = reservationData.num_pax;
            } else {
                reservationData.num_pax = 0;
            }
            return reservationData;
        });
    }

    // Lógica Gesintur (si está visible).
    if (cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false && reservationsToSave) {
        reservationsToSave = reservationsToSave.map((reservation, index) => {
            const reservationData = { ...reservation };
            const reservationType = reservationData.reservation_type || selectedReservationType || 'aereo';
            const isBilletaje = reservationType === 'billetaje';
            const gesinturFields = isBilletaje ? GESINTUR_BILETE_FIELDS : GESINTUR_NORMAL_FIELDS;

            gesinturFields.forEach(field => {
                const inputElement = document.getElementById(`gesintur_${field}_${index}`);
                if (!inputElement) return;
                const value = inputElement.value.trim();
                if (value === '') return;
                if (field.includes('venta_') || field.includes('coste_') || field === 'markup' || field === 'fee') {
                    const numValue = parseFloat(value);
                    reservationData[field] = isNaN(numValue) ? 0 : numValue;
                } else {
                    reservationData[field] = value;
                }
            });
            return reservationData;
        });
    }

    // Lógica ORBISWEB (si está visible).
    if (cachedOrbiswebStatus && cachedIntegrationVisibility.orbisweb !== false && reservationsToSave) {
        const missingNumidsucursal = [];
        reservationsToSave = reservationsToSave.map((reservation, index) => {
            const reservationData = { ...reservation };
            const localizadorGeneral = getGeneralLocatorValue(index, reservationData);
            const requiredFields = ['strlocalizadorpnr', 'strlocalizadorgds'];
            const hasText = (value) => value !== null && value !== undefined && String(value).trim() !== '';

            PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                let value = inputElement ? inputElement.value.trim() : (reservationData[field] ?? '');
                const normalizedField = field.toLowerCase();
                const isPnrOrGds = normalizedField === 'strlocalizadorpnr' || normalizedField === 'strlocalizadorgds';

                if (isPnrOrGds && hasText(localizadorGeneral)) value = localizadorGeneral;

                if (hasText(value)) {
                    if ((normalizedField.startsWith('num') || normalizedField.startsWith('b')) && normalizedField !== 'numuatpsf') {
                        const numValue = parseFloat(value);
                        reservationData[field] = isNaN(numValue) ? 0 : numValue;
                    } else {
                        reservationData[field] = value;
                    }
                } else if (requiredFields.includes(normalizedField)) {
                    if (!missingNumidsucursal.includes(index + 1)) missingNumidsucursal.push(index + 1);
                }
            });

            if (hasText(localizadorGeneral)) {
                syncLocatorFamilyValues(reservationData, localizadorGeneral, PIPELINE_ORBISWEB_FIELDS);
            }
            return reservationData;
        });

        if (validateOrbisRequired && missingNumidsucursal.length > 0) {
            return {
                ok: false,
                missingNumidsucursal
            };
        }
    }

    // Sincronización final de localizadores para todos los casos.
    if (reservationsToSave) {
        reservationsToSave = reservationsToSave.map((reservation, index) => {
            const reservationData = { ...reservation };
            const localizadorGeneral = getGeneralLocatorValue(index, reservationData);
            if (localizadorGeneral) {
                syncLocatorFamilyValues(
                    reservationData,
                    localizadorGeneral,
                    cachedOrbiswebStatus ? PIPELINE_ORBISWEB_FIELDS : null
                );
            }
            return reservationData;
        });
    }

    return {
        ok: true,
        reservationsToSave
    };
}

/**
 * Normaliza cualquier formato de fecha a YYYY-MM-DD (para mostrar y enviar a integraciones).
 * Acepta: dd/mm/yyyy, "25 febrero, 2026", yyyy-mm-dd, etc.
 */
function formatDateToYYYYMMDD(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const s = dateStr.trim();
    if (!s) return '';
    const monthsMap = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
        'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
        'ene': '01', 'abr': '04', 'ago': '08', 'dic': '12'
    };
    const low = s.toLowerCase();
    const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
    const m2 = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
    const m3 = low.match(/(\d{1,2})\s+([a-záéíóúñ]+)\s*,?\s*(\d{4})/);
    if (m3) {
        const monthPart = m3[2].replace(/[^a-z]/g, '').substring(0, 3);
        const mm = monthsMap[monthPart] || '01';
        return `${m3[3]}-${mm}-${m3[1].padStart(2, '0')}`;
    }
    // "jue 15 may" / "thu 15 may" / "15 may" (sin año) → YYYY-MM-DD (año actual)
    const m4 = low.match(/^(?:(?:[a-záéíóúñ]{3,10})\.?\s+)?(\d{1,2})\s+([a-záéíóúñ]+)$/);
    if (m4) {
        const monthPart = m4[2].replace(/[^a-z]/g, '').substring(0, 3);
        const mm = monthsMap[monthPart];
        if (mm) {
            const yyyy = String(new Date().getFullYear());
            return `${yyyy}-${mm}-${m4[1].padStart(2, '0')}`;
        }
    }
    return s;
}

function shouldSetBspTrueFromFormaPago(formaPagoValue) {
    const normalized = String(formaPagoValue || '').trim().toLowerCase();
    // BSP = true cuando es a crédito/CASH (acepta "BSP CASH", "CASH", "BSP").
    // "Tarjeta de crédito" significa pagado al proveedor -> BSP false.
    return normalized.includes('bsp') || normalized.includes('cash');
}

function updateBspVisualForReservation(index, reservationsData = null) {
    const formaPagoInput = document.getElementById(`forma_pago_${index}`);
    const bspInput = document.getElementById(`bsp_${index}`);
    const bspIndicator = document.getElementById(`bsp_indicator_${index}`);
    const bspText = document.getElementById(`bsp_text_${index}`);
    if (!bspInput || !bspIndicator || !bspText) return;

    const formaPagoValue = formaPagoInput ? formaPagoInput.value : '';
    const isBsp = shouldSetBspTrueFromFormaPago(formaPagoValue);

    bspInput.value = isBsp ? 'true' : 'false';
    bspIndicator.textContent = isBsp ? '✓' : '✗';
    bspIndicator.style.backgroundColor = isBsp ? '#28a745' : '#dc3545';
    bspText.textContent = isBsp ? 'BSP Activo' : 'BSP Inactivo';
    bspText.style.color = isBsp ? '#1e7e34' : '#a71d2a';

    if (reservationsData && reservationsData[index]) {
        reservationsData[index].bsp = isBsp;
    }
}

function shouldHideFieldInUI(fieldName, fieldMeta = null) {
    const normalizedField = String(fieldName || '').toLowerCase();

    // Campos de automatización GIAV: su visibilidad SOLO se controla por la integración Gesintur,
    // nunca por la visibilidad estándar genérica (que combinaría scopes owner+integration y suele
    // dar conflictos: aunque el usuario marque visible en owner, una regla de integración a 0 ganaría
    // y dejaría el campo permanentemente oculto sin forma clara de revertirlo desde la UI).
    if (cachedGesinturStatus && isGiavAutomationField(fieldName)) {
        return !isIntegrationFieldVisible('gesintur', normalizedField);
    }

    if (cachedStandardFieldVisibility && typeof cachedStandardFieldVisibility === 'object' && normalizedField in cachedStandardFieldVisibility) {
        if (cachedStandardFieldVisibility[normalizedField] === 0) {
            return true;
        }
    }

    const gesinturOnlyFields = new Set(['accion', 'codigo_oficina', 'cod_oficina', 'codigo_expediente', 'cod_expediente', 'accion_facturacion', 'gastos_gestion', 'recuperacion', 'num_pedido']);
    if (gesinturOnlyFields.has(normalizedField) && !cachedGesinturStatus) {
        return true;
    }

    const orbiswebOnlyFields = new Set(['numcodigocliente', 'numcargoemision', 'numsobrecomision', 'proyecto1', 'proyecto2', 'peticionario']);
    if (orbiswebOnlyFields.has(normalizedField) && !cachedOrbiswebStatus) {
        return true;
    }

    // Gesintur: "observaciones" debe quedar visible y editable en captura.
    if (normalizedField === 'observaciones' && cachedGesinturStatus) {
        return false;
    }

    const hiddenFieldSlugs = new Set([
        'tipo',
        'destino',
        'observaciones',
        'notas',
        'venta',
        'coste',
        'proveedor_documento',
        'clave_tipo',
        'tipo_clave',
        'billetes',
        'residente',
        'familianumerosa',
        'familianumerosa_dto',
        'servicio',
        'tipo_servicio',
        'service_type_captured',
        'detalles_servicio',
        'proyecto',
        'numuatpsf',
        // Orbisweb: ocultar campos no operativos en la UI de extensión
        'strrplargo',
        'strrplargopropietario',
        'strnombreagente',
        'strsignin',
        'breemision',
        'breembolso',
        'strbilleteold',
        'numpenalty',
        'numidtipocobro',
        'strclase',
        'strobservacionesaereo',
        'strcodfarebasis',
        'semisionesco2',
        'numcargoemisionproveedor',
        'numdtoservicio'
    ]);
    if (hiddenFieldSlugs.has(normalizedField)) {
        return true;
    }

    const label = String(fieldMeta?.label || '');
    return /clave\s*tipo|tipo\s*clave/i.test(label);
}

function isResidenteFamNumerosaField(fieldName, fieldMeta = null) {
    const normalizedField = normalizeFieldSlug(fieldName);
    const normalizedLabel = normalizeFieldSlug(fieldMeta?.label || '');
    const looksLikeCombinedField = (value) => (
        value.includes('residente') &&
        (
            value.includes('famnumerosa') ||
            (value.includes('familia') && value.includes('numerosa'))
        )
    );
    return looksLikeCombinedField(normalizedField) || looksLikeCombinedField(normalizedLabel);
}

function isGiavAutomationField(fieldName) {
    const normalized = normalizeFieldSlug(fieldName);
    return ['accion', 'codigooficina', 'codoficina', 'codigoexpediente', 'codexpediente', 'accionfacturacion'].includes(normalized);
}

function shouldHideFieldInCaptureUI(fieldName, fieldMeta = null) {
    if (['via', 'venta', 'coste', 'bsp', 'numidsucursal', 'strtarjeta', 'boneway', 'titular', 'strtitular', 'strlocalizadorpnr', 'strlocalizadorgds', 'strtiporeserva', 'strnumautorizaciontarjeta', 'strnombreproveedoriata', 'strcodigoproveedoriata', 'strcodproveedoriata'].includes(String(fieldName || '').toLowerCase())) {
        return true;
    }
    // El nro de billete se gestiona por pasajero, no como campo genérico.
    if (['num_billete', 'numero_billete', 'codigo_billete'].includes(String(fieldName || '').toLowerCase())) {
        return true;
    }
    if (isResidenteFamNumerosaField(fieldName, fieldMeta)) {
        return true;
    }
    return shouldHideFieldInUI(fieldName, fieldMeta);
}

let activeCustomSelectState = null;

function closeActiveCustomSelectDropdown() {
    if (!activeCustomSelectState) return;
    const { menu, cleanup } = activeCustomSelectState;
    cleanup.forEach(fn => {
        try { fn(); } catch (_) { /* noop */ }
    });
    if (menu && menu.parentNode) {
        menu.parentNode.removeChild(menu);
    }
    activeCustomSelectState = null;
}

function enhanceSelectWithFixedDropdown(nativeSelect) {
    if (!(nativeSelect instanceof HTMLSelectElement)) return;
    if (nativeSelect.dataset.capdataEnhancedDropdown === '1') return;
    nativeSelect.dataset.capdataEnhancedDropdown = '1';

    const parent = nativeSelect.parentNode;
    if (!parent) return;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;';
    parent.insertBefore(wrapper, nativeSelect);
    wrapper.appendChild(nativeSelect);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'capdata-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.style.cssText = 'width:100%;padding:8px 30px 8px 8px;border:1px solid #ccc;border-radius:4px;background-color:#fff;color:#111827;font-size:14px;line-height:1.35;text-align:left;cursor:pointer;position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    wrapper.appendChild(trigger);

    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'display:block;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    trigger.appendChild(labelSpan);

    const arrow = document.createElement('span');
    arrow.textContent = '▼';
    arrow.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;color:#555;pointer-events:none;';
    trigger.appendChild(arrow);

    nativeSelect.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0;';
    nativeSelect.tabIndex = -1;

    const syncLabelFromNative = () => {
        const selected = nativeSelect.options[nativeSelect.selectedIndex];
        const text = (selected && selected.textContent ? selected.textContent : '-- Seleccionar --').trim() || '-- Seleccionar --';
        labelSpan.textContent = text;
    };

    const markSelectedOption = (item, isSelected) => {
        item.style.backgroundColor = isSelected ? '#e8f0fe' : '#fff';
        item.style.color = isSelected ? '#0b57d0' : '#111827';
        item.style.fontWeight = isSelected ? '600' : '400';
    };

    const openMenu = () => {
        if (activeCustomSelectState && activeCustomSelectState.trigger === trigger) {
            closeActiveCustomSelectDropdown();
            return;
        }
        closeActiveCustomSelectDropdown();

        const menu = document.createElement('div');
        menu.style.cssText = 'position:absolute;left:0;top:calc(100% + 4px);width:100%;max-height:220px;background:#fff;border:1px solid #cfd8e3;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.16);overflow:auto;z-index:9999;';
        menu.setAttribute('role', 'listbox');
        menu.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });

        const optionButtons = [];
        Array.from(nativeSelect.options).forEach((opt, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = (opt.textContent || '').trim() || '-- Seleccionar --';
            item.style.cssText = 'display:block;width:100%;padding:8px 10px;border:none;border-bottom:1px solid #f0f3f6;background:#fff;text-align:left;cursor:pointer;font-size:13px;';
            item.disabled = !!opt.disabled;
            if (item.disabled) item.style.opacity = '0.5';
            markSelectedOption(item, idx === nativeSelect.selectedIndex);
            const applySelection = (event) => {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                if (opt.disabled) return;
                nativeSelect.value = opt.value;
                nativeSelect.dispatchEvent(new Event('input', { bubbles: true }));
                nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                syncLabelFromNative();
                closeActiveCustomSelectDropdown();
                trigger.focus();
            };
            item.addEventListener('mousedown', applySelection);
            item.addEventListener('click', applySelection);
            optionButtons.push(item);
            menu.appendChild(item);
        });

        wrapper.appendChild(menu);
        trigger.setAttribute('aria-expanded', 'true');

        const onPointerDown = (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const clickedInside = path.includes(menu) || path.includes(trigger) || menu.contains(event.target) || trigger.contains(event.target);
            if (!clickedInside) {
                closeActiveCustomSelectDropdown();
            }
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                closeActiveCustomSelectDropdown();
                trigger.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);

        activeCustomSelectState = {
            trigger,
            menu,
            cleanup: [
                () => document.removeEventListener('mousedown', onPointerDown, true),
                () => document.removeEventListener('keydown', onKeyDown, true),
                () => trigger.setAttribute('aria-expanded', 'false')
            ]
        };

        const selectedButton = optionButtons[nativeSelect.selectedIndex];
        if (selectedButton) {
            selectedButton.scrollIntoView({ block: 'nearest' });
        }
    };

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        openMenu();
    });
    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu();
        }
    });
    nativeSelect.addEventListener('change', syncLabelFromNative);
    syncLabelFromNative();
}

function createFieldElement(fieldName, value, index, options = {}) {
    const normalizedFieldName = String(fieldName || '').toLowerCase();
    const reservationTypeForRules = options.reservationType || selectedReservationType || 'aereo';
    // 1. Obtener Metadatos del Schema con detección inteligente de respaldo
    let fieldMeta = (window.FIELD_SCHEMA_MAP && window.FIELD_SCHEMA_MAP[fieldName])
                      ? { ...window.FIELD_SCHEMA_MAP[fieldName] }
                      : null;

    // Si no hay metadatos, adivinamos el tipo por el nombre para asegurar que los números funcionen
    if (!fieldMeta) {
        const nameLower = normalizedFieldName;
        let guessedType = 'string';
        
        // Detección de Números (Precios, Tasas, Fees)
        const numericKeywords = ['venta', 'coste', 'markup', 'fee', 'gastos', 'imp_', 'recuperacion', 'total', 'precio', 'iva', 'comision'];
        if (numericKeywords.some(key => nameLower.includes(key))) {
            guessedType = 'number';
        } 
        // Detección de Fechas
        else if (nameLower.includes('fecha') || nameLower.includes('date') || nameLower.includes('nacimiento')) {
            guessedType = 'date';
        }
        // Detección de Booleanos
        else if (nameLower.startsWith('is_') || nameLower.startsWith('has_')) {
            guessedType = 'boolean';
        }

        fieldMeta = { 
            label: fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 
            type: guessedType 
        };
    }

    const fieldId = `${fieldName}_${index}`;
    const group = document.createElement('div');
    group.className = 'field-group';

    // Usamos el label que viene del servidor (o el generado por el guesser)
    const label = document.createElement('label');
    label.setAttribute('for', fieldId);
    label.textContent = getGiavFieldLabelOverride(fieldName, fieldMeta.label);

    // --- A) EXCEPCIONES: CAMPOS QUE SE OCULTAN ---
    if (
        fieldName === 'is_residente' ||
        fieldName === 'is_familia_numerosa' ||
        shouldHideFieldInCaptureUI(fieldName, fieldMeta)
    ) {
        return null;
    }
    if (fieldName !== 'pasajeros' && isConfiguredToHideWhenEmpty(fieldName, reservationTypeForRules) && isEmptyCapturedValue(value)) {
        return null;
    }

    // --- B) CASO ESPECIAL: PASAJEROS (LISTA DETALLADA) ---
    if (fieldName === 'pasajeros' && Array.isArray(value)) {
        const showPassengerDescription = options.showPassengerDescription !== false;
        group.classList.add('field-group-details');
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.className = 'capdata-collapse-toggle';
        summary.textContent = `👤 Ver/Ocultar ${value.length} Pasajero(s)`;
        details.appendChild(summary);

        const passengerList = document.createElement('div');
        passengerList.className = 'passenger-list';
        
        value.forEach((pax, paxIndex) => {
            const paxDiv = document.createElement('div');
            paxDiv.className = 'passenger-card';
            const normalizedTicketNumber = normalizeTicketNumberValue(pax.num_billete || '');
            const showTicketField = normalizedTicketNumber.length > 0;
            const ticketFieldHtml = showTicketField
                ? `<div class="passenger-field-block">
                        <label class="passenger-field-label">Nº Billete:</label>
                        <input type="text" class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="num_billete" value="${normalizedTicketNumber}">
                   </div>`
                : '';

            const passengerDescriptionHtml = showPassengerDescription
                ? `
                <!-- Descripción -->
                <div class="passenger-grid">
                    <div class="passenger-field-block">
                        <label class="passenger-field-label">Descripción:</label>
                        <textarea class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="descripcion" rows="2" style="resize:vertical;">${String(pax.descripcion || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                    </div>
                    <div class="passenger-field-spacer" aria-hidden="true"></div>
                </div>`
                : '';

            // Orbis Web: el NIF del pasajero y el checkbox "titular de su propio
            // servicio" SOLO se muestran (y el NIF solo se autorrellena) si la
            // integración Orbis está activa. Con otras integraciones, o ninguna, no se
            // ven ni se busca el NIF. Checkbox por defecto DESMARCADO: si no se marca, el
            // titular del servicio de este pasajero será el titular del expediente.
            const orbisActiveForPaxFields = (typeof cachedOrbiswebStatus !== 'undefined' && cachedOrbiswebStatus)
                && (typeof cachedIntegrationVisibility === 'undefined' || cachedIntegrationVisibility.orbisweb !== false);
            const nifFieldHtml = orbisActiveForPaxFields
                ? `
                <!-- NIF / Documento (autorrellenado por nombre desde CapData; editable) -->
                <div class="passenger-grid">
                    <div class="passenger-field-block">
                        <label class="passenger-field-label">NIF / Documento:</label>
                        <input type="text" class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="nif" value="${pax.nif || pax.documento || pax.dni || ''}" placeholder="NIF del pasajero">
                    </div>
                    <div class="passenger-field-spacer" aria-hidden="true"></div>
                </div>`
                : '';
            const titularServicioHtml = orbisActiveForPaxFields
                ? `
                <!-- Orbis: ¿este pasajero es titular de su propio servicio? (se factura a su NIF) -->
                <div class="passenger-grid">
                    <div class="passenger-field-block">
                        <label class="passenger-field-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;">
                            <input type="checkbox" class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="es_titular_servicio" ${pax.es_titular_servicio ? 'checked' : ''} style="width:auto;margin:0;flex:0 0 auto;cursor:pointer;">
                            <span>Titular de su propio servicio</span>
                        </label>
                    </div>
                    <div class="passenger-field-spacer" aria-hidden="true"></div>
                </div>`
                : '';

            paxDiv.innerHTML = `
                <div class="passenger-header">
                    <span>Pasajero ${paxIndex + 1}: ${pax.nombre_pax || ''}</span>
                    <span class="passenger-id-badge">ID: ${pax.contact_id || 'Nuevo'}</span>
                </div>

                <!-- Nombre + Tipo Pasajero -->
                <div class="passenger-grid">
                    <div class="passenger-field-block">
                        <label class="passenger-field-label">Nombre:</label>
                        <input type="text" class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="nombre_pax" value="${pax.nombre_pax || ''}">
                    </div>
                    <div class="passenger-field-block">
                        <label class="passenger-field-label">Tipo Pasajero:</label>
                        <select class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="tipo_pax">
                            <option value="Ad" ${pax.tipo_pax === 'Ad' ? 'selected' : ''}>Adulto</option>
                            <option value="Ch" ${pax.tipo_pax === 'Ch' ? 'selected' : ''}>Niño</option>
                            <option value="Na" ${pax.tipo_pax === 'Na' ? 'selected' : ''}>Bebé</option>
                        </select>
                    </div>
                </div>

                ${nifFieldHtml}
                ${titularServicioHtml}

                <!-- Nº Billete + Residente Fam Numerosa -->
                <div class="passenger-grid">
                    <div class="passenger-field-block">
                        <label class="passenger-field-label">Residente Fam Numerosa:</label>
                        <select class="pax-data-input passenger-field-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="residente_fam_numerosa">
                            <option value="false" ${(pax.residente_fam_numerosa === true || pax.residente_fam_numerosa === 'true') ? '' : 'selected'}>No</option>
                            <option value="true" ${(pax.residente_fam_numerosa === true || pax.residente_fam_numerosa === 'true') ? 'selected' : ''}>Sí</option>
                        </select>
                    </div>
                    ${ticketFieldHtml}
                </div>
                ${passengerDescriptionHtml}
            `;
            passengerList.appendChild(paxDiv);
        });
        
        details.appendChild(passengerList);
        group.appendChild(label);
        group.appendChild(details);
        details.addEventListener('toggle', notifySizeChange);
        return group;
    }

    // --- C) LÓGICA DE INPUTS SEGÚN TIPO DE DATO ---
    let input;

    if (fieldName !== 'pasajeros' && (Array.isArray(value) || (value && typeof value === 'object'))) {
        input = document.createElement('textarea');
        input.id = fieldId;
        input.name = fieldId;
        input.rows = 3;
        input.style.resize = 'vertical';
        input.value = JSON.stringify(value, null, 2);
        group.appendChild(label);
        group.appendChild(input);
        return group;
    }

    if (normalizedFieldName === 'numidexpediente') {
        input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.name = fieldId;
        input.value = String(value ?? '');
        group.appendChild(label);
        group.appendChild(input);
        return group;

    } else if (fieldName === 'bsp') {
        group.classList.add('field-group-switch');
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.id = fieldId;
        hiddenInput.name = fieldId;

        const badgeContainer = document.createElement('div');
        badgeContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const indicator = document.createElement('span');
        indicator.id = `bsp_indicator_${index}`;
        indicator.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:999px; color:white; font-weight:bold; font-size:14px;';

        const statusText = document.createElement('span');
        statusText.id = `bsp_text_${index}`;
        statusText.style.cssText = 'font-size:12px; font-weight:bold;';

        badgeContainer.appendChild(indicator);
        badgeContainer.appendChild(statusText);
        group.appendChild(label);
        group.appendChild(hiddenInput);
        group.appendChild(badgeContainer);
        return group;

    } else if (fieldMeta.type === 'boolean' || fieldName.startsWith('is_')) {
        group.classList.add('field-group-switch');
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.id = fieldId;
        input.checked = (value === true || value === 'true' || value === 1);
        const slider = document.createElement('span');
        slider.className = 'slider round';
        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        group.appendChild(label);
        group.appendChild(switchLabel);
        return group;

    } else if (fieldMeta.type === 'enum' || fieldName === 'tipo_residente' || fieldName === 'tipo_familia_numerosa' || fieldName === 'accion' || fieldName === 'accion_facturacion' || fieldName === 'forma_pago') {
        input = document.createElement('select');
        input.id = fieldId;
        input.name = fieldId;

        let options = fieldMeta.options || [];
        // Fallback para selects técnicos si no vienen en el schema
        if (options.length === 0) {
            if (fieldName === 'tipo_residente') options = ['', 'Sin descuento', 'Residente islas o Ceuta (75%)'];
            if (fieldName === 'tipo_familia_numerosa') options = ['', 'Sin descuento', 'Fam. numerosa general (5%)', 'Fam. numerosa especial (10%)'];
            if (fieldName === 'accion') options = ['solo_captura', 'volcar_expediente'];
            if (fieldName === 'accion_facturacion') options = ['ninguna', 'facturar_cliente', 'facturar_pasajeros'];
            if (fieldName === 'forma_pago') {
                // Desplegable de forma de pago (Tarjeta de crédito = pagado al
                // proveedor; BSP CASH = a crédito -> activa BSP). Evita errores de
                // escritura manual. Si la captura trajo otro valor, se conserva.
                options = ['Tarjeta de crédito', 'BSP CASH'];
                const curFp = String(value || '').trim();
                if (curFp && !options.some(o => o.toLowerCase() === curFp.toLowerCase())) {
                    options = [curFp, ...options];
                }
            }
        }

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = getGiavSelectOptionLabel(fieldName, opt);
            if (String(value).toLowerCase() === String(opt).toLowerCase()) option.selected = true;
            input.appendChild(option);
        });
        group.appendChild(label);
        group.appendChild(input);
        enhanceSelectWithFixedDropdown(input);

    } else if (fieldMeta.type === 'number') {
        input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01'; // Permite decimales para Venta, Coste, etc.
        input.id = fieldId;
        input.name = fieldId;
        
        // Limpiamos el valor de basura (ej: "350.50 EUR" -> "350.50")
        let cleanVal = String(value || '').replace(/[^\d.,-]/g, '').replace(',', '.');
        
        // Validamos que si hay varios puntos (miles), dejamos solo el decimal
        const parts = cleanVal.split('.');
        if (parts.length > 2) {
            cleanVal = parts.slice(0, -1).join('') + '.' + parts.slice(-1);
        }
        
        input.value = cleanVal || '';
        group.appendChild(label);
        group.appendChild(input);

    } else if (fieldMeta.type === 'date') {
        input = document.createElement('input');
        input.type = 'date';
        input.id = fieldId;
        input.name = fieldId;
        // Intentamos convertir a YYYY-MM-DD para el input date HTML
        input.value = formatDateToYYYYMMDD(value || '') || '';
        group.appendChild(label);
        group.appendChild(input);

    } else if (fieldMeta.type === 'time') {
        input = document.createElement('input');
        input.type = 'time';
        input.id = fieldId;
        input.name = fieldId;
        input.value = value || '';
        group.appendChild(label);
        group.appendChild(input);

    } else {
        // DEFAULT: Texto plano
        input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.name = fieldId;
        const safeValue = value ?? '';
        // Si el nombre contiene "fecha" pero el tipo no era date, intentamos formatear igual
        const isDateField = fieldName.toLowerCase().includes('fecha');
        input.value = isDateField ? (formatDateToYYYYMMDD(safeValue) || safeValue) : String(safeValue);
        group.appendChild(label);
        group.appendChild(input);
    }

    return group;
}


async function collectSingleFieldData(index) {
    // 1. OBTENER LOS DATOS PREVIAMENTE CAPTURADOS (Background/IA)
    const { savedReservationData } = await chrome.storage.local.get('savedReservationData');
    const originalReservation = savedReservationData?.[index] || {};
    
    // IMPORTANTE: Iniciamos con una copia de TODO lo capturado originalmente.
    // Esto asegura que los campos con 'is_visible: 0' (que no tienen input en el DOM)
    // mantengan su valor y se envíen al backend.
    const data = { ...originalReservation };
    
    const reservationType = data.reservation_type || selectedReservationType || 'aereo';
    
    // 2. CONSTRUIR LA LISTA TOTAL DE CAMPOS POSIBLES
    let fieldsToCollect = [...STANDARD_FIELDS];
    
    if (typeof ALL_SERVICE_FIELDS !== 'undefined' && ALL_SERVICE_FIELDS[reservationType]) {
        fieldsToCollect = [...fieldsToCollect, ...ALL_SERVICE_FIELDS[reservationType]];
    }
    
    if (cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false && reservationType === 'billetaje') {
        fieldsToCollect = [...fieldsToCollect, ...BILLETAGE_FIELDS];
    }
    if (cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false) {
        const isBilletaje = reservationType === 'billetaje';
        const gesinturFields = isBilletaje ? (GESINTUR_BILETE_FIELDS || []) : (GESINTUR_NORMAL_FIELDS || []);
        const gesinturVisible = gesinturFields.filter(f => isIntegrationFieldVisible('gesintur', f));
        fieldsToCollect = [...fieldsToCollect, ...gesinturVisible];
    }
    
    if (cachedAvsisStatus && cachedIntegrationVisibility.avsis !== false) {
        const avsisVisible = (AVSIS_SPECIFIC_FIELDS || []).filter(f => isIntegrationFieldVisible('avsis', f));
        fieldsToCollect = [...fieldsToCollect, ...avsisVisible];
    }
    if (cachedOrbiswebStatus && cachedIntegrationVisibility.orbisweb !== false && typeof PIPELINE_ORBISWEB_FIELDS !== 'undefined' && PIPELINE_ORBISWEB_FIELDS.length) {
        const orbisVisible = PIPELINE_ORBISWEB_FIELDS.filter(f => isIntegrationFieldVisible('orbisweb', f));
        fieldsToCollect = [...fieldsToCollect, ...orbisVisible];
    }

    if (window.CUSTOM_SCHEMA) {
        window.CUSTOM_SCHEMA.forEach(cf => fieldsToCollect.push(cf.slug));
    }
    
    fieldsToCollect = [...new Set(fieldsToCollect)];
    fieldsToCollect = applyExclusiveGestionFields(fieldsToCollect, reservationType);

    // 3. RECOLECTAR VALORES DE LOS INPUTS VISIBLES (EDICIÓN MANUAL)
    fieldsToCollect.forEach(field => {
        if (field === 'pasajeros') return;
        
        const inputElement = document.getElementById(`${field}_${index}`);
        
        // SOLO si el elemento existe en el DOM (está visible), actualizamos el valor.
        // Si no existe, 'data[field]' conserva lo que traía de la captura original.
        if (inputElement) {
            if (inputElement.type === 'checkbox') {
                data[field] = inputElement.checked;
            } else {
                let value = inputElement.value.trim();

                // Lógica especial para Tarjeta
                if (field === 'strTarjeta') {
                    let cleanCard = value.replace(/[\s-]/g, '');
                    if (cleanCard === "") {
                        data[field] = null;
                    } else {
                        data[field] = cleanCard.length < 16 ? cleanCard.padStart(16, '*') : cleanCard.substring(0, 16);
                    }
                } 
                // Lógica para Números y Precios
                else if (inputElement.type === 'number' || field === 'num_pasajeros') {
                    data[field] = (value !== '') ? (parseFloat(value) || 0) : 0;
                } 
                // Lógica para Fechas
                else if (field.toLowerCase().includes('fecha') || inputElement.type === 'date') {
                    data[field] = value === '' ? null : (formatDateToYYYYMMDD(value) || value);
                }
                // Texto General
                else {
                    data[field] = value === '' ? null : value;
                }
            }
        }
    });

    // 4. SINCRONIZACIONES DE NEGOCIO OBLIGATORIAS
    data.bsp = shouldSetBspTrueFromFormaPago(data.forma_pago);

    // Sincronizar precio -> venta/coste (el backend suele requerir los 3)
    const precioInput = document.getElementById(`precio_${index}`);
    if (precioInput) {
        const pVal = precioInput.value.trim() === '' ? null : precioInput.value.trim();
        data.precio = pVal;
        data.venta = pVal;
        data.coste = pVal;
    }
    
    // 5. RECOLECTAR CAMPOS ERP (GESINTUR) — solo si está visible
    if (cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false) {
        const isBilletaje = reservationType === 'billetaje';
        const gesinturFields = isBilletaje ? GESINTUR_BILETE_FIELDS : GESINTUR_NORMAL_FIELDS;
        
        gesinturFields.forEach(field => {
            const inputElement = document.getElementById(`gesintur_${field}_${index}`);
            if (inputElement) {
                const val = inputElement.value.trim();
                if (val !== '') {
                    const isNumeric = field.includes('venta_') || field.includes('coste_') || field === 'markup' || field === 'fee';
                    data[field] = isNumeric ? parseFloat(val) || 0 : val;
                }
            }
        });
    }
    
    // 6. RECOLECTAR CAMPOS ERP (ORBISWEB / PIPELINE) — solo si está visible
    if (cachedOrbiswebStatus && cachedIntegrationVisibility.orbisweb !== false) {
        const localizadorGeneral = getGeneralLocatorValue(index, data);
        if (typeof PIPELINE_ORBISWEB_FIELDS !== 'undefined') {
            PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                let value = inputElement ? inputElement.value.trim() : (data[field] ?? null);

                // PNR y GDS heredan el localizador manual si el usuario lo cambió
                if ((field.toLowerCase() === 'strlocalizadorpnr' || field.toLowerCase() === 'strlocalizadorgds') && localizadorGeneral) {
                    value = localizadorGeneral;
                }

                if (value !== null && String(value).trim() !== '') {
                    const normalizedField = field.toLowerCase();
                    if ((normalizedField.startsWith('num') || normalizedField.startsWith('b')) && normalizedField !== 'numuatpsf') {
                        data[field] = parseFloat(value) || 0;
                    } else {
                        const isDateField = normalizedField.includes('fecha') || normalizedField.includes('date') || normalizedField.includes('dt');
                        data[field] = isDateField ? (formatDateToYYYYMMDD(String(value)) || String(value)) : String(value);
                    }
                } else if (!(field in data)) {
                    data[field] = null;
                }
            });
        }

        // Sincronizar localizadores
        if (localizadorGeneral) {
            syncLocatorFamilyValues(data, localizadorGeneral, PIPELINE_ORBISWEB_FIELDS);
        }

        // IATA Lookup para Aerolínea Proveedora
        const providerName = data.proveedor_nombre ?? data.via ?? '';
        const airlinesMap = await getAirlinesIataMap();
        const providerIataCode = lookupAirlineCode(providerName, airlinesMap) || null;
        
        data.Strcodigoproveedoriata = providerIataCode; // Clave canónica Orbis

        // Flag Solo Ida
        data.BOneWay = hasReturnJourneyData(data) ? 0 : 1;
    }

    // 7. ASIGNAR METADATOS FINALES Y RUTA
    const activeSiteUrl = await getActiveSiteUrl();
    if (activeSiteUrl) {
        data.via = `web ${activeSiteUrl}`;
    }

    if (isGiavReservationFlow(reservationType)) {
        const genericDesc = buildGenericFlightDescription(data);
        if (genericDesc) data.descripcion = genericDesc;
    }

    enforceExclusiveGestionFieldsInPayload(data, reservationType, fieldsToCollect);

    // Incluir siempre todos los custom fields en el payload (visibles y ocultos; oculto = solo no se muestra en UI, sí se envía al backend)
    if (window.CUSTOM_SCHEMA && Array.isArray(window.CUSTOM_SCHEMA)) {
        window.CUSTOM_SCHEMA.forEach(cf => {
            if (!cf || !cf.slug) return;
            if (!(cf.slug in data)) data[cf.slug] = originalReservation[cf.slug] ?? null;
        });
    }

    data.reservation_type = reservationType;
    const selectedServiceType = getReservationTypeBase(
        String(document.getElementById('mainServiceType')?.value || selectedReservationType || reservationType || 'aereo')
    );
    const isGiavActive = cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false;
    data.tipo = (isGiavActive && selectedServiceType === 'aereo') ? 'AV' : selectedServiceType;
    
    // 8. PROCESAR PASAJEROS (Actualizar números de billete editados)
    if (data.pasajeros && Array.isArray(data.pasajeros)) {
        data.num_pax = data.pasajeros.length;
        data.pasajeros = data.pasajeros.map((pax, paxIndex) => {
            const ticketInput = document.getElementById(`pax_ticket_${index}_${paxIndex}`);
            const passengerData = { ...pax };
            if (ticketInput) {
                passengerData.num_billete = normalizeTicketNumberValue(ticketInput.value);
            } else if (Object.prototype.hasOwnProperty.call(passengerData, 'num_billete')) {
                passengerData.num_billete = normalizeTicketNumberValue(passengerData.num_billete);
            }
            // El FORMULARIO manda: re-leemos los inputs visibles del pasajero (NIF,
            // nombre, etc.). Si el usuario los borra o cambia, se envía lo que hay en
            // el campo AHORA, no el dato sincronizado antiguo. (Antes el NIF borrado
            // se enviaba igual porque solo se leía savedReservationData.)
            document.querySelectorAll(
                `.pax-data-input[data-res-index="${index}"][data-pax-index="${paxIndex}"]`
            ).forEach(inp => {
                const key = inp.getAttribute('data-key');
                if (!key || key === 'num_billete') return;
                if (inp.type === 'checkbox') {
                    passengerData[key] = inp.checked;
                } else if (key === 'residente_fam_numerosa' || key === 'is_residente' || key === 'is_familia_numerosa') {
                    passengerData[key] = (inp.value === 'true');
                } else {
                    passengerData[key] = (inp.value || '').trim();
                }
            });
            return passengerData;
        });
    } else {
        data.num_pax = parseInt(data.num_pasajeros) || 0;
    }

    // Titular (Primer pasajero)
    const firstP = Array.isArray(data.pasajeros) ? data.pasajeros[0] : null;
    if (firstP) {
        const fullName = `${firstP.nombre_pax || ''} ${firstP.primer_apellidos_pax || firstP.apellidos_pax || ''}`.trim();
        data.titular = fullName;
        data.strtitular = fullName;
    }

    // Construir objeto final solo con las claves que queremos enviar (evita enviar datos viejos/legacy que provocan bugs)
    const allowedKeys = new Set([...fieldsToCollect, 'pasajeros', 'num_pax', 'reservation_type', 'tipo', 'titular', 'strtitular']);
    if (window.CUSTOM_SCHEMA && Array.isArray(window.CUSTOM_SCHEMA)) {
        window.CUSTOM_SCHEMA.forEach(cf => { if (cf?.slug) allowedKeys.add(cf.slug); });
    }
    const out = {};
    allowedKeys.forEach(key => {
        if (key in data) out[key] = data[key];
    });

    // Campos personalizados: no perderlos por un allowedKeys incompleto o desfase con CUSTOM_SCHEMA
    const ensureCustomSlugInOut = (slug) => {
        if (!slug || typeof slug !== 'string') return;
        if (Object.prototype.hasOwnProperty.call(data, slug)) {
            out[slug] = data[slug];
        } else if (Object.prototype.hasOwnProperty.call(originalReservation, slug)) {
            out[slug] = originalReservation[slug];
        }
    };
    if (window.CUSTOM_SCHEMA && Array.isArray(window.CUSTOM_SCHEMA)) {
        window.CUSTOM_SCHEMA.forEach(cf => ensureCustomSlugInOut(cf && cf.slug));
    }
    if (window.FIELD_SCHEMA_MAP && typeof window.FIELD_SCHEMA_MAP === 'object') {
        for (const slug of Object.keys(window.FIELD_SCHEMA_MAP)) {
            const meta = window.FIELD_SCHEMA_MAP[slug];
            if (meta && meta.is_custom) ensureCustomSlugInOut(slug);
        }
    }

    // Fallback defensivo: si por cualquier motivo CUSTOM_SCHEMA no esta cargado
    // (o llega incompleto), no perder claves custom ya capturadas en storage.
    // Solo replica claves que vengan de la reserva original y no esten ya en out.
    for (const [key, value] of Object.entries(originalReservation || {})) {
        if (Object.prototype.hasOwnProperty.call(out, key)) continue;
        if (value === undefined) continue;
        out[key] = value;
    }

    // Asegurar meta que el backend espera
    if (!('reservation_type' in out)) out.reservation_type = data.reservation_type || reservationType;
    if (!('num_pax' in out)) out.num_pax = data.num_pax;

    return out;
}

function hasReturnJourneyData(data) {
    const explicitReturnFields = [
        'aerolinea_vuelta',
        'num_vuelo_vuelta',
        'aeropuerto_salida_vuelta',
        'fecha_vuelta',
        'hora_salida_vuelta',
        'aeropuerto_llegada_vuelta',
        'hora_llegada_vuelta',
        'Vuelta_Compania',
        'Vuelta_Codigo',
        'Vuelta_Origen_Fecha',
        'Vuelta_Origen_Hora',
        'Vuelta_Origen_Lugar',
        'Vuelta_Destino_Fecha',
        'Vuelta_Destino_Hora',
        'Vuelta_Destino_Lugar'
    ];

    const hasValue = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return value.trim() !== '';
        return true;
    };

    if (explicitReturnFields.some((field) => hasValue(data[field]))) {
        return true;
    }

    return Object.entries(data).some(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        const isReturnKey = normalizedKey.includes('vuelta') || normalizedKey.includes('return');
        return isReturnKey && hasValue(value);
    });
}

// Función para validar un campo requerido de orbisweb individual
function validateOrbiswebRequiredField(input) {
    if (input.getAttribute('data-required-orbisweb') === 'true' && input.value.trim() === '') {
        input.classList.add('required-error');
        const fieldGroup = input.closest('.field-group');
        if (fieldGroup && !fieldGroup.querySelector('.error-message')) {
            const errorMsg = document.createElement('span');
            errorMsg.className = 'error-message';
            errorMsg.textContent = 'Este campo es obligatorio cuando ORBISWEB está activa';
            errorMsg.style.color = '#dc3545';
            errorMsg.style.fontSize = '11px';
            errorMsg.style.display = 'block';
            errorMsg.style.marginTop = '4px';
            fieldGroup.appendChild(errorMsg);
        }
        return false;
    } else {
        input.classList.remove('required-error');
        const errorMsg = input.closest('.field-group')?.querySelector('.error-message');
        if (errorMsg) errorMsg.remove();
        return true;
    }
}

// Función para validar todos los campos requeridos de orbisweb en todas las reservas
function validateAllOrbiswebRequiredFields() {
    if (!cachedOrbiswebStatus || cachedIntegrationVisibility.orbisweb === false) {
        return null;
    }
    
    const requiredFields = ['strlocalizadorpnr', 'strlocalizadorgds'];
    const missingFieldsByReservation = {}; // { index: [fieldNames] }
    
    // Buscar TODOS los inputs con ID que contenga "pipeline" y alguno de los campos requeridos (case-insensitive)
    const allPipelineInputs = Array.from(document.querySelectorAll('input[id*="pipeline"], select[id*="pipeline"], textarea[id*="pipeline"]'));
    console.log("🔍 Total inputs pipeline encontrados:", allPipelineInputs.length);
    
    allPipelineInputs.forEach((input) => {
        const inputIdLower = input.id.toLowerCase();
        
        // Verificar si es uno de los campos requeridos
        const isRequiredField = requiredFields.some(rf => inputIdLower.includes(rf.toLowerCase()));
        
        if (isRequiredField) {
            // Extraer el índice del ID
            const match = input.id.match(/pipeline_[^_]*_(\d+)$/i);
            if (match) {
                const index = parseInt(match[1]);
                const reservationNum = index + 1;
                
                console.log(`🔍 Validando ${input.id}, valor: "${input.value}"`);
                
                if (input.value.trim() === '') {
                    // PNR y GDS: si están vacíos pero la reserva tiene localizador general, se rellenan al guardar → no marcar error
                    const isPnrOrGds = inputIdLower.includes('strlocalizadorpnr') || inputIdLower.includes('strlocalizadorgds');
                    const skipAsFilledByGeneral = isPnrOrGds && getGeneralLocatorValue(index) !== '';

                    if (!skipAsFilledByGeneral) {
                        if (!missingFieldsByReservation[reservationNum]) {
                            missingFieldsByReservation[reservationNum] = [];
                        }
                        const fieldName = PIPELINE_ORBISWEB_FIELDS.find(f => 
                            input.id.toLowerCase().includes(f.toLowerCase())
                        ) || 'campo requerido';
                        missingFieldsByReservation[reservationNum].push(fieldName);
                        validateOrbiswebRequiredField(input);
                        if (Object.keys(missingFieldsByReservation).length === 1 && missingFieldsByReservation[reservationNum].length === 1) {
                            setTimeout(() => {
                                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                input.focus();
                            }, 100);
                        }
                    }
                }
            }
        }
    });
    
    if (Object.keys(missingFieldsByReservation).length > 0) {
        const errorMessages = [];
        Object.keys(missingFieldsByReservation).forEach(reservationNum => {
            const fields = missingFieldsByReservation[reservationNum];
            errorMessages.push(`Reserva ${reservationNum}: ${fields.join(', ')}`);
        });
        return `⚠️ Los siguientes campos son obligatorios cuando ORBISWEB está activa:\n${errorMessages.join('\n')}`;
    }
    
    return null;
}

function enterFolder(folderId, folderName, ui) {
    // 1. Actualizar Estado Global
    currentFolderId = folderId; // Si es null, volvemos a raíz
    currentFolderName = folderName;
    currentPage = 1; // Resetear a página 1
    selectedContact = null; // Limpiar selección
    
    // 2. Actualizar UI inmediata
    ui.fillWithContactBtn.disabled = true;
    ui.contactFilterInput.value = ''; // Limpiar buscador al entrar/salir
    
    // 3. Recargar Datos
    const apiKey = ui.apiKeyInput.value.trim();
    fetchAndDisplayContacts(ui, apiKey);
}

// Función para validar campos requeridos de orbisweb para una reserva específica
function validateOrbiswebRequiredFieldForIndex(index) {
    if (!cachedOrbiswebStatus || cachedIntegrationVisibility.orbisweb === false) return null;
    
    const requiredFields = ['strlocalizadorpnr', 'strlocalizadorgds'];
    const missingFields = [];
    
    // Buscar todos los campos requeridos: los de la lista
    PIPELINE_ORBISWEB_FIELDS.forEach(field => {
        const isRequired = requiredFields.some(rf => field.toLowerCase() === rf.toLowerCase());
        if (isRequired) {
            const inputElement = document.getElementById(`pipeline_${field}_${index}`);
            if (inputElement && inputElement.value.trim() === '') {
                // PNR y GDS: si hay localizador general en la reserva, se rellenan al guardar → no marcar error
                const isPnrOrGds = field.toLowerCase() === 'strlocalizadorpnr' || field.toLowerCase() === 'strlocalizadorgds';
                const skipAsFilledByGeneral = isPnrOrGds && getGeneralLocatorValue(index) !== '';
                if (!skipAsFilledByGeneral) {
                    missingFields.push(field);
                    validateOrbiswebRequiredField(inputElement);
                    if (missingFields.length === 1) {
                        inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        inputElement.focus();
                    }
                }
            }
        }
    });
    
    if (missingFields.length > 0) {
        return `⚠️ Los siguientes campos son obligatorios cuando ORBISWEB está activa en la reserva ${index + 1}: ${missingFields.join(', ')}`;
    }
    return null;
}

function showStatus(ui, message, type) {
    if (!ui || !ui.statusDiv) return;
    const statusDiv = ui.statusDiv;
    const activeIntegrationBanners = [];
    if (cachedAvsisStatus === true) activeIntegrationBanners.push('✅ Integración AVSIS ACTIVA.');
    if (cachedGesinturStatus === true) activeIntegrationBanners.push('✅ Integración Gesintur ACTIVA.');
    if (cachedOrbiswebStatus === true) activeIntegrationBanners.push('✅ Integración Pipeline/ORBISWEB ACTIVA.');
    const transientMessage = String(message ?? '')
        .replace(/(?:^|\s)(?:✅\s*)?Integración\s+[A-Za-zÁÉÍÓÚÜÑ0-9/_-]+\s+ACTIVA\.?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const hasTransientMessage = transientMessage.length > 0;

    statusDiv.innerHTML = '';
    statusDiv.className = '';

    activeIntegrationBanners.forEach((bannerText) => {
        const banner = document.createElement('div');
        banner.className = 'status-success';
        banner.textContent = bannerText;
        statusDiv.appendChild(banner);
    });

    if (hasTransientMessage) {
        const transient = document.createElement('div');
        transient.className = `status-${type || 'info'}`;
        transient.textContent = transientMessage;
        if (activeIntegrationBanners.length > 0) transient.style.marginTop = '6px';
        statusDiv.appendChild(transient);
    }

    statusDiv.style.display = (activeIntegrationBanners.length > 0 || hasTransientMessage) ? 'block' : 'none';
}

function showSpinner(ui, show) {
    ui.spinner.style.display = show ? 'block' : 'none';
    ui.capturarReservaBtn.disabled = show;
    document.querySelectorAll('.save-single-reservation-btn, .view-payload-btn').forEach(btn => btn.disabled = show);
    if(ui.clearBtn) ui.clearBtn.disabled = show;
}

function clearFormDOM(ui) {
    closeActiveCustomSelectDropdown();
    ui.standardFieldsContainer.innerHTML = '';
    ui.formContainer.style.display = 'none';
    ui.globalActionsRow.style.display = 'none';
}
