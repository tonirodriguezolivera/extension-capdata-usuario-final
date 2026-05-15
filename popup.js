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
const STANDARD_FIELD_VISIBILITY_REFRESH_KEY = 'standardFieldVisibilityRefreshTs';
const INTEGRATION_FIELD_VISIBILITY_REFRESH_KEY = 'integrationFieldVisibilityRefreshTs';
let captureHideWhenEmptyRules = {};
let currentCaptureDomain = '';

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

function isGiavReservationFlow(reservationType) {
    const baseType = getReservationTypeBase(reservationType);
    const isFlightFlow = reservationType === 'billetaje' || baseType === 'aereo';
    const isGesinturFlow = cachedGesinturStatus;
    const isGiavFlow = !cachedAvsisStatus && !cachedGesinturStatus && !cachedOrbiswebStatus;
    return isFlightFlow && (isGesinturFlow || isGiavFlow);
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
            
            // Notificar el cambio de tamaño al cambiar de pestaña
            notifySizeChange(); 
        });
    });
    // --- FIN LÓGICA DE PESTAÑAS ---

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
    const { savedReservationData } = await chrome.storage.local.get('savedReservationData');
    
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

            await loadIntegrationVisibility(userApiKey);
            await loadIntegrationFieldVisibility(userApiKey);
            const avsisResultEffective = applyIntegrationStatusFallbackFromVisibility(avsisResult, 'avsis', '✅ Integración AVSIS ACTIVA.');
            const gesinturResultEffective = applyIntegrationStatusFallbackFromVisibility(gesinturResult, 'gesintur', '✅ Integración Gesintur ACTIVA.');
            const orbiswebResultEffective = applyIntegrationStatusFallbackFromVisibility(orbiswebResult, 'orbisweb', '✅ Integración Pipeline/ORBISWEB ACTIVA.');
            cachedAvsisStatus = avsisResultEffective.active;
            cachedGesinturStatus = gesinturResultEffective.active;
            cachedOrbiswebStatus = orbiswebResultEffective.active;
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            
            // Mostrar selector de tipo ORBISWEB solo si orbisweb está activo
            const orbiswebTypeContainer = document.getElementById('orbiswebTypeContainer');
            if (orbiswebTypeContainer) {
                orbiswebTypeContainer.style.display = 'none';
            }
            
            // Preparar mensajes de estado
            const messages = ['Mostrando última reserva capturada.'];
            const hasActiveIntegrations = avsisResultEffective.active || gesinturResultEffective.active || orbiswebResultEffective.active;
            
            if (avsisResultEffective.message) messages.push(avsisResultEffective.message);
            if (gesinturResultEffective.message) messages.push(gesinturResultEffective.message);
            if (orbiswebResultEffective.message) messages.push(orbiswebResultEffective.message);
            
            showStatus(ui, messages.join(' '), hasActiveIntegrations ? 'success' : 'info');
        } else {
            showStatus(ui, 'Mostrando última reserva capturada.', 'info');
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

            await loadIntegrationVisibility(userApiKey);
            await loadIntegrationFieldVisibility(userApiKey);
            const avsisResultEffective = applyIntegrationStatusFallbackFromVisibility(avsisResult, 'avsis', '✅ Integración AVSIS ACTIVA.');
            const gesinturResultEffective = applyIntegrationStatusFallbackFromVisibility(gesinturResult, 'gesintur', '✅ Integración Gesintur ACTIVA.');
            const orbiswebResultEffective = applyIntegrationStatusFallbackFromVisibility(orbiswebResult, 'orbisweb', '✅ Integración Pipeline/ORBISWEB ACTIVA.');
            cachedAvsisStatus = avsisResultEffective.active;
            cachedGesinturStatus = gesinturResultEffective.active;
            cachedOrbiswebStatus = orbiswebResultEffective.active;
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            
            const orbiswebTypeContainer = document.getElementById('orbiswebTypeContainer');
            if (orbiswebTypeContainer) {
                orbiswebTypeContainer.style.display = cachedOrbiswebStatus ? 'block' : 'none';
            }
            
            const messages = [];
            if (avsisResultEffective.message) messages.push(avsisResultEffective.message);
            if (gesinturResultEffective.message) messages.push(gesinturResultEffective.message);
            if (orbiswebResultEffective.message) messages.push(orbiswebResultEffective.message);
            
            if (messages.length > 0) {
                showStatus(ui, messages.join(' '), 'success');
            } else {
                showStatus(ui, '', 'info');
            }
        } else {
            showStatus(ui, 'Por favor, guarda tu API Key.', 'info');
        }
    }
    showSpinner(ui, false);
}

async function checkAvsisStatus(apiKey) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkAvsisIntegration', apiKey });
        if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
        
        if (response.status === 'success' && response.integrations) {
            const isActive = response.integrations.some(int => int.slug === 'avsis' && int.active);
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
        
        if (response.status === 'success' && response.integrations) {
            const isActive = response.integrations.some(int => int.slug === 'gesintur' && int.active);
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
        
        if (response.status === 'success' && response.integrations) {
            // Debug: mostrar todas las integraciones para verificar el slug exacto
            // console.log("🔍 Integraciones recibidas:", response.integrations);
            const orbiswebIntegration = response.integrations.find(int => 
                int.slug && (int.slug.toLowerCase() === 'orbisweb' || 
                            int.slug.toLowerCase() === 'orbis_web' || 
                            int.slug.toLowerCase() === 'orbis-web' ||
                            int.slug.toLowerCase().includes('orbis'))
            );
            // console.log("🔍 Integración ORBISWEB encontrada:", orbiswebIntegration);
            
            const isActive = orbiswebIntegration ? orbiswebIntegration.active : false;
            const message = isActive ? '✅ Integración Pipeline/ORBISWEB ACTIVA.' : '';
            return { active: isActive, message: message };
        }
        return { active: false, message: `⚠️ ${response.message || 'Respuesta inesperada.'}` };
    } catch (error) {
        return { active: false, message: `🚨 Error de conexión: ${error.message}` };
    }
}

function applyIntegrationStatusFallbackFromVisibility(result, slug, activeMessage) {
    const current = result && typeof result === 'object' ? result : { active: false, message: '' };
    if (current.active) return current;
    if (cachedIntegrationVisibility && cachedIntegrationVisibility[slug] === true) {
        return { active: true, message: activeMessage };
    }
    return current;
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
                for (const selector of selectorList) {
                    try {
                        if (document.querySelector(selector)) return true;
                    } catch (_) {
                        // Ignorar selectores no válidos en esta comprobación.
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
    await chrome.storage.local.remove('savedReservationData');
    clearFormDOM(ui);
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

    const section = document.createElement('div');
    section.className = 'field-group-details';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);

    const grid = document.createElement('div');
    grid.className = 'fields-grid-container';
    grid.style.marginTop = '10px';

    allowedFields.forEach(field => {
        const fieldElement = createFieldElement(field, data[field], index, { reservationType });
        if (fieldElement) grid.appendChild(fieldElement);
    });

    details.appendChild(grid);
    details.addEventListener('toggle', notifySizeChange);
    section.appendChild(details);
    return section;
}

function buildMultiEditableForm(ui, reservationsData) {
    // 1. Limpiar el contenedor de cualquier formulario anterior.
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
        if (fieldsToRender.includes('pasajeros') && data.pasajeros) {
            const showPassengerDescription = !isGiavReservationFlow(rawResType);
            const passengersElement = createFieldElement('pasajeros', data.pasajeros, index, { showPassengerDescription, reservationType: rawResType });
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
                if (fieldsDiv.children.length > 0) {
                    const giavAutomationContainer = document.createElement('div');
                    giavAutomationContainer.className = 'giav-automation-fields-container erp-fields-block';
                    giavAutomationContainer.style.cssText = 'margin-top: 14px; padding: 10px 0; border-top: 1px solid #e5e7eb;';
                    giavAutomationContainer.appendChild(fieldsDiv);
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
            const avsisContainer = document.createElement('div');
            avsisContainer.className = 'avsis-fields-container erp-fields-block';
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
            avsisContainer.appendChild(fieldsDiv);
            wrapper.appendChild(avsisContainer);
        }

        // C) Integración con Gesintur (solo si está activa y visible); visibilidad por campo se gestiona en el mapeador
        if (typeof cachedGesinturStatus !== 'undefined' && cachedGesinturStatus && cachedIntegrationVisibility.gesintur !== false) {
            const gesinturContainer = document.createElement('div');
            gesinturContainer.className = 'gesintur-fields-container erp-fields-block';
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
            gesinturContainer.appendChild(fieldsDiv);
            wrapper.appendChild(gesinturContainer);
        }

        // D) Integración con ORBISWEB/Pipeline (solo si está activa y visible); visibilidad por campo se gestiona en el mapeador
        if (typeof cachedOrbiswebStatus !== 'undefined' && cachedOrbiswebStatus && cachedIntegrationVisibility.orbisweb !== false) {
            const pipelineContainer = document.createElement('div');
            pipelineContainer.className = 'pipeline-fields-container erp-fields-block';
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
            pipelineContainer.appendChild(fieldsDiv);
            wrapper.appendChild(pipelineContainer);
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
        input.addEventListener('change', (e) => {
            const resIdx = e.target.getAttribute('data-res-index');
            const paxIdx = e.target.getAttribute('data-pax-index');
            const key = e.target.getAttribute('data-key');

            if (resIdx !== null && paxIdx !== null && key && reservationsData[resIdx]) {
                const val = (key === 'is_residente' || key === 'is_familia_numerosa' || key === 'residente_fam_numerosa')
                    ? (e.target.value === 'true')
                    : e.target.value;
                if (!reservationsData[resIdx].pasajeros) reservationsData[resIdx].pasajeros = [];
                if (reservationsData[resIdx].pasajeros[paxIdx]) {
                    reservationsData[resIdx].pasajeros[paxIdx][key] = val;
                    chrome.storage.local.set({ savedReservationData: reservationsData });
                }
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

    if (typeof notifySizeChange === 'function') {
        notifySizeChange();
    }
}

async function saveAllNewReservations(ui) {
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

        const response = await chrome.runtime.sendMessage({
            action: 'saveAllReservations', 
            apiKey: apiKey,
            reservationsData: reservationsToSave
        });

        if (response.status === 'ok') {
            showStatus(ui, response.message, 'success');
            
            ui.saveAllBtn.style.display = 'none';
            ui.discardBtn.style.display = 'none';
            ui.clearBtn.style.display = 'inline-block';

            document.querySelectorAll('.view-payload-btn').forEach(btn => {
                btn.disabled = false;
                btn.title = "Ver todos los campos que se enviarán al backend";
            });

        } else {
            showStatus(ui, `Error: ${response.message}`, 'error');
            ui.saveAllBtn.disabled = false; 
        }

    } catch (e) {
        showStatus(ui, `Error de comunicación: ${e.message}`, 'error');
        ui.saveAllBtn.disabled = false;
    } finally {
        showSpinner(ui, false);
    }
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
    return normalized === 'bsp' || normalized === 'cash';
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
    label.textContent = fieldMeta.label;

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
        summary.textContent = `👤 Ver/Ocultar ${value.length} Pasajero(s)`;
        details.appendChild(summary);

        const passengerList = document.createElement('div');
        passengerList.className = 'passenger-list';
        
        value.forEach((pax, paxIndex) => {
            const paxDiv = document.createElement('div');
            paxDiv.style.cssText = 'margin-bottom: 15px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;';

            const passengerDescriptionHtml = showPassengerDescription
                ? `
                <!-- Descripción -->
                <div style="margin-bottom: 8px;">
                    <label style="display: block; font-size: 10px; color: #6b7280;">Descripción:</label>
                    <textarea class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="descripcion" rows="2" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px; resize:vertical;">${String(pax.descripcion || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>`
                : '';

            paxDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 10px; color: #111827; font-size: 13px; display:flex; justify-content:space-between;">
                    <span>Pasajero ${paxIndex + 1}: ${pax.nombre_pax || ''} ${pax.primer_apellidos_pax || ''}</span>
                    <span style="color:#0672ff; font-size:10px;">ID: ${pax.contact_id || 'Nuevo'}</span>
                </div>

                <!-- Nombre y Apellido -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                    <div>
                        <label style="display: block; font-size: 10px; color: #6b7280;">Nombre:</label>
                        <input type="text" class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="nombre_pax" value="${pax.nombre_pax || ''}" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 10px; color: #6b7280;">Apellido:</label>
                        <input type="text" class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="primer_apellidos_pax" value="${pax.primer_apellidos_pax || ''}" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                    </div>
                </div>

                <!-- Nº Billete y Tipo Pasajero -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                    <div>
                        <label style="display: block; font-size: 10px; color: #6b7280;">Nº Billete:</label>
                        <input type="text" class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="num_billete" value="${pax.num_billete || ''}" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 10px; color: #6b7280;">Tipo Pasajero:</label>
                        <select class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="tipo_pax" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                            <option value="Ad" ${pax.tipo_pax === 'Ad' ? 'selected' : ''}>Adulto</option>
                            <option value="Ch" ${pax.tipo_pax === 'Ch' ? 'selected' : ''}>Niño</option>
                            <option value="Na" ${pax.tipo_pax === 'Na' ? 'selected' : ''}>Bebé</option>
                        </select>
                    </div>
                </div>

                <!-- Residente Fam Numerosa -->
                <div style="margin-bottom: 8px;">
                    <label style="display: block; font-size: 10px; color: #6b7280;">Residente Fam Numerosa:</label>
                    <select class="pax-data-input" data-res-index="${index}" data-pax-index="${paxIndex}" data-key="residente_fam_numerosa" style="width:100%; padding:4px; font-size:11px; border:1px solid #ccc; border-radius:4px;">
                        <option value="false" ${(pax.residente_fam_numerosa === true || pax.residente_fam_numerosa === 'true') ? '' : 'selected'}>No</option>
                        <option value="true" ${(pax.residente_fam_numerosa === true || pax.residente_fam_numerosa === 'true') ? 'selected' : ''}>Sí</option>
                    </select>
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

    } else if (fieldMeta.type === 'enum' || fieldName === 'tipo_residente' || fieldName === 'tipo_familia_numerosa' || fieldName === 'accion' || fieldName === 'accion_facturacion') {
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
        }

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt || '-- Seleccionar --';
            if (String(value).toLowerCase() === String(opt).toLowerCase()) option.selected = true;
            input.appendChild(option);
        });
        group.appendChild(label);
        group.appendChild(input);

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
                passengerData.num_billete = ticketInput.value.trim();
            }
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
    const hasGesinturBanner = cachedGesinturStatus === true;
    const transientMessage = String(message ?? '')
        .replace(/(?:^|\s)(?:✅\s*)?Integración\s+[A-Za-zÁÉÍÓÚÜÑ0-9/_-]+\s+ACTIVA\.?/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const hasTransientMessage = transientMessage.length > 0;

    statusDiv.innerHTML = '';
    statusDiv.className = '';

    if (hasGesinturBanner) {
        const banner = document.createElement('div');
        banner.className = 'status-success';
        banner.textContent = '✅ Integración Gesintur ACTIVA.';
        statusDiv.appendChild(banner);
    }

    if (hasTransientMessage) {
        const transient = document.createElement('div');
        transient.className = `status-${type || 'info'}`;
        transient.textContent = transientMessage;
        if (hasGesinturBanner) transient.style.marginTop = '6px';
        statusDiv.appendChild(transient);
    }

    statusDiv.style.display = (hasGesinturBanner || hasTransientMessage) ? 'block' : 'none';
}

function showSpinner(ui, show) {
    ui.spinner.style.display = show ? 'block' : 'none';
    ui.capturarReservaBtn.disabled = show;
    document.querySelectorAll('.save-single-reservation-btn, .view-payload-btn').forEach(btn => btn.disabled = show);
    if(ui.clearBtn) ui.clearBtn.disabled = show;
}

function clearFormDOM(ui) {
    ui.standardFieldsContainer.innerHTML = '';
    ui.formContainer.style.display = 'none';
    ui.globalActionsRow.style.display = 'none';
}
