// mapping.js - Ventana de Mapeo Separada (Completa)
let currentMappings = {};
let allServiceFields = {}; 
let commonFields = [];     
let currentTabId = null;
let avsisFields = [];
let gesinturBilleteFields = [];
let gesinturNormalFields = [];
let pipelineOrbiswebFields = [];
let integrationsActive = {
    avsis: false,
    gesintur: false,
    orbisweb: false
};
// English field labels (completo desde popup.js)
const FIELD_LABELS_EN = {
    // Main Info
    "localizador": "Alternative Locator",
    "codigo_reserva": "Booking Code",
    "estado_booking": "Status",
    "fecha_booking": "Booking Date",
    "fecha_emision": "Issue Date",
    "precio": "Price",
    "divisa": "Currency",
    "forma_pago": "Payment Method",
    "proveedor": "Provider",
    "proveedor_codigo": "Provider Code",
    "tipo_servicio": "Service Type",
    "is_fake": "Is Fake",
    // Outbound Flight
    "aerolinea_ida": "Outbound Airline",
    "num_vuelo_ida": "Outbound Flight",
    "aeropuerto_salida_ida": "Outbound Origin",
    "fecha_ida": "Outbound Date",
    "hora_salida": "Outbound Departure Time",
    "aeropuerto_llegada_ida": "Outbound Destination",
    "hora_llegada_ida": "Outbound Arrival Time",
    // Return Flight
    "aerolinea_vuelta": "Return Airline",
    "num_vuelo_vuelta": "Return Flight",
    "aeropuerto_salida_vuelta": "Return Origin",
    "fecha_vuelta": "Return Date",
    "hora_salida_vuelta": "Return Departure Time",
    "aeropuerto_llegada_vuelta": "Return Destination",
    "hora_llegada_vuelta": "Return Arrival Time",
    "num_pasajeros_vuelta": "Return Passengers",
    // Passengers
    "pasajeros": "Passengers",
    "num_pasajeros": "Number of Passengers",
    "nombre_pax": "Passenger Name",
    "apellidos_pax": "Passenger Surname",
    "primer_apellidos_pax": "First Surname",
    // Discounts
    "is_residente": "Resident",
    "tipo_residente": "Resident Type",
    "is_familia_numerosa": "Large Family",
    "tipo_familia_numerosa": "Large Family Type",
    // Economic
    "imp_total_coste": "Total Cost",
    "imp_total_venta": "Total Sale",
    "imp_mark_up": "Mark-Up",
    "imp_cancelacion": "Cancellation Fees",
    "imp_tasas": "Taxes",
    "imp_total_tasas": "Total Taxes",
    "imp_fee_servicio": "Service Fee",
    "imp_fee_emision": "Issue Fee",
    // Other
    "num_maletas_incluidas": "Included Bags",
    "rent_a_car": "Car Rental",
    "resumen_reserva": "Reservation Summary",
    "resumen_reserva_largo": "Long Summary",
    "notas": "Notes",
    "direccion": "Address",
    "servicio": "Service Detail",
    // Apsys
    "expediente": "Apsys File",
    "proveedor_documento": "Provider Document",
    "estado": "Apsys Status",
    "prestador_documento": "Provider Document",
    "localizador_bovo": "Bovo Locator",
    "loc_reubica": "Relocation Locator",
    "fecha_solicitud": "Request Date",
    "observaciones": "Observations",
    "tipo_rfg_iva": "RFG IVA Type",
    "tipo_suministro": "Supply Type",
    "producto": "Apsys Product",
    "t_liquido": "Net Amount",
    "tarifa": "Rate",
    "tarifa_gv": "GV Rate",
    "tasa_gv": "GV Tax",
    "porcentaje_comision": "Commission %",
    "imp_comision": "Commission Amount",
    "iva_comision": "Commission VAT",
    "pvp": "Retail Price",
    "dto_efectivo": "Cash Discount",
    "tasa_d": "Tax D",
    "porcentaje_descuento": "Discount %",
    "importe_descuento": "Discount Amount",
    "total_servicio": "Total Service",
    "tipo_servicio_avion": "Aircraft Service Type",
    "num_billete": "Ticket Number",
    "tipo_billete": "Ticket Type",
    "comisionado": "Commissioned",
    "bsp": "BSP",
    "vta_exenta": "Exempt Sale",
    "punto_venta": "Point of Sale",
    "nombre_apellidos_pax": "Full Name",
    "fecha_presenta_facturacion": "Billing Date",
    "rechazar_gastos": "Reject Expenses"
};

const FIELD_DESCRIPTIONS_ES = {
    // --- Información Principal ---
    "localizador": "Referencia alternativa o localizador GDS, si es diferente al código de reserva.",
    "codigo_reserva": "El PNR principal o código de referencia de la reserva (normalmente 6 caracteres alfanuméricos).",
    "estado_booking": "Estado actual de la reserva (ej: Confirmada, Pendiente, Cancelada).",
    "fecha_booking": "La fecha en la que se creó inicialmente la reserva.",
    "fecha_emision": "La fecha en la que el billete, bono o documento fue emitido oficialmente.",
    "precio": "El precio final total de la reserva, incluyendo todos los conceptos e impuestos.",
    "divisa": "El código de moneda asociado al precio (ej: EUR, USD, GBP).",
    "forma_pago": "El método utilizado para pagar la reserva (ej: VISA, Efectivo, Factura).",
    "proveedor": "El nombre del proveedor de servicios o consolidador.",
    "proveedor_codigo": "El código interno o estándar de la industria que identifica al proveedor.",
    "tipo_servicio": "La categoría del servicio (ej: Vuelo, Hotel, Seguro).",
    "is_fake": "Indicador interno para identificar si se trata de una reserva de prueba o simulada.",

    // --- Vuelo de Ida ---
    "aerolinea_ida": "La aerolínea que opera el vuelo de ida.",
    "num_vuelo_ida": "El número del vuelo de ida (ej: IB3402).",
    "aeropuerto_salida_ida": "El nombre del aeropuerto de origen o código IATA para el viaje de ida.",
    "fecha_ida": "La fecha de salida para el viaje de ida.",
    "hora_salida": "La hora programada de salida para el vuelo de ida.",
    "aeropuerto_llegada_ida": "El nombre o código del aeropuerto de destino para el viaje de ida.",
    "hora_llegada_ida": "La hora programada de llegada para el vuelo de ida.",

    // --- Vuelo de Vuelta ---
    "aerolinea_vuelta": "La aerolínea que opera el vuelo de vuelta.",
    "num_vuelo_vuelta": "El número del vuelo de vuelta (ej: IB3403).",
    "aeropuerto_salida_vuelta": "El nombre o código del aeropuerto de origen para el viaje de vuelta.",
    "fecha_vuelta": "La fecha de salida para el viaje de vuelta.",
    "hora_salida_vuelta": "La hora programada de salida para el vuelo de vuelta.",
    "aeropuerto_llegada_vuelta": "El nombre o código del aeropuerto de destino para el viaje de vuelta.",
    "hora_llegada_vuelta": "La hora programada de llegada para el vuelo de vuelta.",
    "num_pasajeros_vuelta": "El recuento de pasajeros que viajan en el trayecto de vuelta.",

    // --- Pasajeros ---
    "pasajeros": "La sección o lista que contiene todos los nombres e información de los pasajeros.",
    "num_pasajeros": "El número total de pasajeros incluidos en esta reserva.",
    "nombre_pax": "El nombre (nombre de pila) del pasajero.",
    "apellidos_pax": "Los apellidos del pasajero.",
    "primer_apellidos_pax": "El primer apellido principal del pasajero.",

    // --- Descuentos ---
    "is_residente": "Indicador de si se ha aplicado un descuento por residencia.",
    "tipo_residente": "La categoría del descuento de residente (ej: Islas Canarias, Baleares).",
    "is_familia_numerosa": "Indicador de si se ha aplicado un descuento por familia numerosa.",
    "tipo_familia_numerosa": "La categoría del estado de familia numerosa (General o Especial).",

    // --- Económico ---
    "imp_total_coste": "El precio de coste total pagado al proveedor.",
    "imp_total_venta": "El precio de venta final cobrado al cliente.",
    "imp_mark_up": "El margen de beneficio o recargo aplicado por la agencia.",
    "imp_cancelacion": "Gastos o penalizaciones asociados a la cancelación del servicio.",
    "imp_tasas": "El importe correspondiente específicamente a tasas aeroportuarias o gubernamentales.",
    "imp_total_tasas": "La suma de todas las tasas y cargos gubernamentales adicionales.",
    "imp_fee_servicio": "La tarifa de servicio (fee) cobrada por la agencia.",
    "imp_fee_emision": "La tarifa cobrada por la emisión del billete o documento.",

    // --- Otros ---
    "num_maletas_incluidas": "El número de maletas facturadas incluidas en la tarifa.",
    "rent_a_car": "Detalles relativos a los servicios de alquiler de coches, si aplica.",
    "resumen_reserva": "Un breve resumen textual de los detalles de la reserva.",
    "resumen_reserva_largo": "Una descripción detallada o extensa de toda la reserva.",
    "notas": "Comentarios adicionales, observaciones o notas internas sobre la reserva.",
    "direccion": "La dirección física asociada al servicio o al cliente.",
    "servicio": "Detalles específicos o descripción del servicio prestado.",

    // --- Apsys (Integración Técnica) ---
    "expediente": "El número de expediente o registro interno dentro del sistema Apsys.",
    "proveedor_documento": "El ID de documento específico proporcionado por el proveedor.",
    "estado": "El estado operativo dentro de la integración con Apsys.",
    "prestador_documento": "El documento de identificación del proveedor del servicio.",
    "localizador_bovo": "La referencia de localizador interna utilizada por el sistema Bovo.",
    "loc_reubica": "Referencia de localizador para pasajeros reubicados o reprotegidos.",
    "fecha_solicitud": "La fecha y hora en la que se realizó la solicitud del servicio.",
    "observaciones": "Observaciones técnicas internas o registros (logs).",
    "tipo_rfg_iva": "La categoría específica de IVA/Impuesto (RFG) aplicada al registro.",
    "tipo_suministro": "La categoría de adquisición o suministro en Apsys.",
    "producto": "El nombre o tipo de producto específico definido en Apsys.",
    "t_liquido": "El importe líquido neto después de comisiones y antes de impuestos.",
    "tarifa": "La tarifa base o precio neto sin cargos adicionales.",
    "tarifa_gv": "La tarifa específica aplicada para viajes de grupo (GV).",
    "tasa_gv": "Las tasas asociadas específicamente a las tarifas de viajes de grupo.",
    "porcentaje_comision": "El porcentaje de comisión devengada.",
    "imp_comision": "El valor monetario total de la comisión.",
    "iva_comision": "El importe de IVA aplicado a la comisión devengada.",
    "pvp": "Precio de Venta al Público (PVP) incluyendo todos los impuestos.",
    "dto_efectivo": "Descuento aplicado por pagos en efectivo o transferencias bancarias directas.",
    "tasa_d": "Importe específico de la tasa clase D, si aplica.",
    "porcentaje_descuento": "El porcentaje de descuento aplicado.",
    "importe_descuento": "El valor monetario total del descuento aplicado.",
    "total_servicio": "El total general para esta línea de servicio específica.",
    "tipo_servicio_avion": "Código de categoría de servicio de aeronave específico de Apsys.",
    "num_billete": "El número específico de billete o billete electrónico (usualmente 13 dígitos).",
    "tipo_billete": "El tipo de billete emitido (ej: Electrónico, Papel, MCO).",
    "comisionado": "Indicador de si el servicio ya ha sido comisionado.",
    "bsp": "Indicador de si el billete pertenece al plan de facturación BSP.",
    "vta_exenta": "Indica si la venta está exenta de impuestos específicos.",
    "punto_venta": "El identificador del punto de venta físico o digital.",
    "nombre_apellidos_pax": "El nombre completo del pasajero (Nombre + Apellidos).",
    "fecha_presenta_facturacion": "La fecha en la que el registro fue enviado para facturación.",
    "rechazar_gastos": "Indicador para señalar si los gastos deben ser rechazados en Apsys."
};

async function checkIntegrationsStatus() {
    const apiKey = await getApiKey();
    if (!apiKey) return;

    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'checkApsysIntegration', // Reutilizamos la acción del background que ya tienes
            apiKey: apiKey 
        });

        if (response && response.status === 'success' && response.integrations) {
            integrationsActive.avsis = response.integrations.some(int => int.slug === 'avsis' && int.active);
            integrationsActive.gesintur = response.integrations.some(int => int.slug === 'gesintur' && int.active);
            integrationsActive.orbisweb = response.integrations.some(int => (int.slug === 'orbisweb' || int.slug === 'orbis_web') && int.active);
            console.log("Estados de integración cargados:", integrationsActive);
        }
    } catch (error) {
        console.error("Error verificando integraciones para mapping:", error);
    }
}

function getFieldDescription(fieldName) {
    return FIELD_DESCRIPTIONS_ES[fieldName] || "Select the element on the page that contains this data.";
}

function getFieldLabel(fieldName) {
    return FIELD_LABELS_EN[fieldName] || fieldName;
}

function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `status-${type}`;
        statusDiv.style.display = 'block';
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}

// Mostrar indicador de progreso para búsqueda de selectores con IA
function showAISearchProgress(message = 'Buscando selectores con IA...', subtext = 'Esto puede tardar unos segundos') {
    const progressDiv = document.getElementById('aiSearchProgress');
    const progressText = document.getElementById('aiSearchProgressText');
    const progressSubtext = document.getElementById('aiSearchProgressSubtext');
    
    if (progressDiv) {
        if (progressText) progressText.textContent = message;
        if (progressSubtext) progressSubtext.textContent = subtext;
        progressDiv.classList.add('show');
    }
}

// Ocultar indicador de progreso para búsqueda de selectores con IA
function hideAISearchProgress() {
    const progressDiv = document.getElementById('aiSearchProgress');
    if (progressDiv) {
        progressDiv.classList.remove('show');
    }
}

// Get API Key from storage
async function getApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['userApiKey'], (result) => {
            console.log('API Key from storage:', result.userApiKey ? 'Found' : 'Not found');
            resolve(result.userApiKey || '');
        });
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Mapping window initialized');
    document.getElementById('mappingType').addEventListener('change', () => {
        console.log("Cambiando modo a:", document.getElementById('mappingType').value);
        loadMappings();      
        renderMappingFields(); 
    });
    // Get domain and tabId from URL parameters (passed from background)
    const urlParams = new URLSearchParams(window.location.search);
    const domainFromUrl = urlParams.get('domain');
    const tabIdFromUrl = urlParams.get('tabId');
    
    if (domainFromUrl) {
        const domainInput = document.getElementById('mappingDomain');
        if (domainInput) {
            domainInput.value = domainFromUrl;
            console.log('Domain set from URL:', domainFromUrl);
        }
    }
    
    if (tabIdFromUrl) {
        currentTabId = parseInt(tabIdFromUrl);
        console.log('Tab ID set from URL:', currentTabId);
    }
    
    // Also try to get current tab as fallback
    if (!currentTabId || !domainFromUrl) {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            console.log('Current tabs:', tabs);
            if (tabs && tabs.length > 0 && tabs[0] && tabs[0].url) {
                if (!currentTabId) {
                    currentTabId = tabs[0].id;
                }
                if (!domainFromUrl) {
                    try {
                        const url = new URL(tabs[0].url);
                        const domainInput = document.getElementById('mappingDomain');
                        if (domainInput && !domainInput.value) {
                            domainInput.value = url.hostname;
                            console.log('Domain set from tab:', url.hostname);
                        }
                    } catch (e) {
                        console.error('Error parsing URL:', e);
                    }
                }
            } else {
                console.warn('No active tab found');
            }
        } catch (error) {
            console.error('Error getting current tab:', error);
        }
    }
    
    // Load fields definition
    console.log('Loading fields definition...');
    try {
        const data = await chrome.runtime.sendMessage({ action: 'getFieldsDefinition' });
        console.log('Fields definition response:', data);
        if (data && data.status === 'success') {
            // CAMBIO: Guardamos la nueva estructura del servidor
            allServiceFields = data.service_fields; 
            commonFields = data.common_fields || [];
            
            console.log('Campos cargados para servicios:', Object.keys(allServiceFields));
            avsisFields = data.avsis_fields || [];
            gesinturBilleteFields = data.gesintur_billete_fields || [];
            gesinturNormalFields = data.gesintur_normal_fields || [];
            pipelineOrbiswebFields = data.pipeline_orbisweb_fields || [];
            await checkIntegrationsStatus();
            // Renderizamos por primera vez
            renderMappingFields();
            
            // Si hay dominio, intentar cargar mapeos automáticamente
            const domain = document.getElementById('mappingDomain').value.trim();
            if (domain) {
                const apiKey = await getApiKey();
                if (apiKey) {
                    setTimeout(() => loadMappings(), 500);
                }
            }
        }
    } catch (err) {
        console.error('Error loading fields definition:', err);
        showStatus('Error cargando definición de campos: ' + err.message, 'error');
    }
    
    // Event listeners
    const serviceTypeSelect = document.getElementById('mappingServiceType');
    const onewayControl = document.getElementById('onewayControl');
    const isOneWayCheckbox = document.getElementById('isOneWay');

    const updateOnewayUI = () => {
        const serviceType = serviceTypeSelect.value;
        // Solo mostramos el checkbox para Aéreo o Tren
        if (serviceType === 'aereo' || serviceType === 'tren') {
            onewayControl.style.display = 'block';
        } else {
            onewayControl.style.display = 'none';
            isOneWayCheckbox.checked = false; // Resetear si se cambia a Hotel/Car
        }
    };

    // Listener para el cambio de servicio
    serviceTypeSelect.addEventListener('change', () => {
        updateOnewayUI();
        renderMappingFields(); 
        loadMappings();       
    });

    // Listener para el cambio del checkbox Solo Ida
    isOneWayCheckbox.addEventListener('change', () => {
        console.log("Modo Solo Ida:", isOneWayCheckbox.checked);
        renderMappingFields(); 
        loadMappings();
    });

    // Ejecutar al inicio para que se vea si el valor por defecto es Aéreo
    updateOnewayUI();
    document.getElementById('loadMappingsBtn').addEventListener('click', loadMappings);
    document.getElementById('batchSelectMode').addEventListener('change', () => {
        updateBatchSelectMode();
        updateMapSelectedButton();
        updateFindAIButton();
        updateSelectAllCheckbox();
    });
    document.getElementById('mapSelectedBtn').addEventListener('click', mapSelectedFields);
    document.getElementById('findAIForSelectedBtn').addEventListener('click', findAllSelectorsWithAI);
    document.getElementById('selectAllFields').addEventListener('change', handleSelectAllFields);
    document.getElementById('deleteAllMappingsBtn').addEventListener('click', deleteAllMappings);
    async function deleteAllMappings() {
        const domain = document.getElementById('mappingDomain').value.trim();
        const fieldType = document.getElementById('mappingType').value;
        const serviceType = document.getElementById('mappingServiceType').value;
        const isOneWay = document.getElementById('isOneWay').checked; // <--- 1. LEER EL CHECKBOX
        const apiKey = await getApiKey();

        if (!domain || !serviceType) {
            showStatus('Selecciona dominio y servicio primero', 'error');
            return;
        }

        let finalServiceType = serviceType;
        if (isOneWay && (serviceType === 'aereo' || serviceType === 'tren')) {
            finalServiceType = `${serviceType}_oneway`;
        }

        // Actualizamos el mensaje para que el usuario sepa exactamente qué está borrando
        const msm = `¿Estás seguro de que quieres borrar TODOS los campos mapeados para:\nDominio: ${domain}\nTipo: ${fieldType}\nServicio: ${finalServiceType}?\n\nEsta acción no se puede deshacer.`;
        
        if (!confirm(msm)) return;

        try {
            showStatus(`Borrando mapeos de ${finalServiceType}...`, 'info');
            const response = await chrome.runtime.sendMessage({
                action: 'deleteAllFieldSelectors', 
                apiKey: apiKey,
                domain: domain,
                fieldType: fieldType,
                serviceType: finalServiceType 
            });

            if (response && response.status === 'success') {
                currentMappings = {}; 
                renderMappingFields(); 
                showStatus(`¡Mapeo de ${finalServiceType} eliminado por completo!`, 'success');
            } else {
                showStatus(response.message || 'Error al borrar', 'error');
            }
        } catch (error) {
            showStatus('Error de conexión', 'error');
        }
    }
    // Listen for mapping completion
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'mappingCompleted') {
            loadMappings(); // Reload mappings
            showStatus('Mapeo guardado exitosamente', 'success');
        }
        return true;
    });
});

// Load existing mappings
async function loadMappings() {
    const domain = document.getElementById('mappingDomain').value.trim();
    const fieldType = document.getElementById('mappingType').value;
    const serviceType = document.getElementById('mappingServiceType').value;
    const isOneWay = document.getElementById('isOneWay').checked; // <--- LEER EL CHECKBOX
    const apiKey = await getApiKey();
    
    if (!domain) {
        showStatus('Por favor ingresa un dominio', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus('Por favor ingresa tu API Key en el popup principal', 'error');
        return;
    }

    // --- LÓGICA DE SUB-TIPO (SOLO IDA) ---
    // Si el check está marcado y es un servicio que admite tramos (Aéreo o Tren),
    // modificamos el slug que enviamos al servidor.
    let finalServiceType = serviceType;
    if (isOneWay && (serviceType === 'aereo' || serviceType === 'tren')) {
        finalServiceType = `${serviceType}_oneway`;
    }
    
    try {
        console.log(`Cargando mapeos para: Dominio=${domain}, Tipo=${fieldType}, Servicio=${finalServiceType}`);
        
        const data = await chrome.runtime.sendMessage({
            action: 'getFieldSelectors',
            apiKey: apiKey,
            domain: domain,
            fieldType: fieldType,
            serviceType: finalServiceType // Enviamos el slug final (ej: aereo_oneway)
        });
        
        if (data && data.status === 'success') {
            currentMappings = data.mappings || {};
            // Redibujamos la interfaz para que los campos mapeados salgan en verde
            renderMappingFields();
            showStatus(`Cargados ${data.total_mappings} mapeos para ${domain} (${finalServiceType})`, 'success');
        } else {
            // Si el servidor no tiene mapeos, limpiamos los actuales y redibujamos
            currentMappings = {};
            renderMappingFields();
            showStatus(data?.message || 'No hay mapeos guardados para este escenario.', 'info');
        }
    } catch (error) {
        console.error('Error loading mappings:', error);
        showStatus('Error de conexión al cargar mapeos', 'error');
    }
}

// Render mapping fields (completo desde popup.js)
function renderMappingFields() {
    const container = document.getElementById('mappingFieldsContainer');
    const serviceTypeSelect = document.getElementById('mappingServiceType');
    const mappingTypeSelect = document.getElementById('mappingType');
    const isOneWayCheckbox = document.getElementById('isOneWay');
    
    if (!container || !serviceTypeSelect || !mappingTypeSelect) {
        console.error('Mapping fields container or selectors not found');
        return;
    }

    // 1. Obtener el servicio, el tipo de mapeo y si es Solo Ida
    const serviceType = serviceTypeSelect.value;
    const mappingType = mappingTypeSelect.value; // 'capture' o 'autofill'
    const isOneWay = isOneWayCheckbox ? isOneWayCheckbox.checked : false;
    
    // --- LÓGICA DE PERSISTENCIA PARA IA ---
    const aiResultsBlock = document.getElementById('aiSelectorsResults');
    container.innerHTML = '';
    if (aiResultsBlock) {
        container.appendChild(aiResultsBlock);
    }

    // 2. Definir los campos base a mostrar
    let fieldsToShow = [];
    let fieldGroups = {};

    if (mappingType === 'autofill') {
        // --- CONFIGURACIÓN PARA AUTORELLENADO (Formularios de pasajeros) ---
        fieldGroups = {
            'Datos Personales': [
                'nombre_pax', 'apellidos_pax', 'primer_apellidos_pax', 
                'nombre_apellidos_pax', 'fecha_nac', 'genero_pax', 'tratamiento_pax'
            ],
            'Documentación': [
                'num_documento', 'tipo_documento', 'fecha_caducidad_doc', 'pais_emision_doc'
            ],
            'Contacto y Dirección': [
                'email_pax', 'telefono_pax', 'direccion_pax'
            ],
            'Descuentos y Otros': [
                'is_residente', 'tipo_residente', 'is_familia_numerosa', 'tipo_familia_numerosa'
            ]
        };
        fieldsToShow = Object.values(fieldGroups).flat();

    } else {
        // --- CONFIGURACIÓN PARA CAPTURA (Extracción de datos de la reserva) ---
        const safeCommonFields = Array.isArray(commonFields) ? commonFields : [];
        const specificFields = (allServiceFields && allServiceFields[serviceType]) ? allServiceFields[serviceType] : [];
        fieldsToShow = [...safeCommonFields, ...specificFields];

        if (serviceType === 'aereo') {
            fieldGroups = {
                'Información Principal': ['localizador', 'codigo_reserva', 'estado_booking', 'fecha_booking', 'fecha_emision', 'precio', 'divisa', 'forma_pago', 'proveedor', 'proveedor_codigo', 'is_fake'],
                'Vuelo de Ida': ['aerolinea_ida', 'num_vuelo_ida', 'aeropuerto_salida_ida', 'fecha_ida', 'hora_salida', 'aeropuerto_llegada_ida', 'hora_llegada_ida'],
                'Vuelo de Vuelta': ['aerolinea_vuelta', 'num_vuelo_vuelta', 'aeropuerto_salida_vuelta', 'fecha_vuelta', 'hora_salida_vuelta', 'aeropuerto_llegada_vuelta', 'hora_llegada_vuelta', 'num_pasajeros_vuelta'],
                'Pasajeros': ['pasajeros', 'num_pasajeros'],
                'Económicos': ['imp_total_coste', 'imp_total_venta', 'imp_mark_up', 'imp_cancelacion', 'imp_tasas', 'imp_total_tasas', 'imp_fee_servicio', 'imp_fee_emision']
            };

            // --- LÓGICA FILTRADO SOLO IDA ---
            if (isOneWay) {
                // 1. Eliminamos el grupo visual de Vuelta
                delete fieldGroups['Vuelo de Vuelta'];
                
                // 2. Definimos qué campos son estrictamente de vuelta para quitarlos de la lista maestra
                const returnFields = ['aerolinea_vuelta', 'num_vuelo_vuelta', 'aeropuerto_salida_vuelta', 'fecha_vuelta', 'hora_salida_vuelta', 'aeropuerto_llegada_vuelta', 'hora_llegada_vuelta', 'num_pasajeros_vuelta'];
                
                // 3. Filtramos fieldsToShow para que el cálculo de la barra de progreso sea exacto
                fieldsToShow = fieldsToShow.filter(f => !returnFields.includes(f));
            }

            // Sumar integraciones solo en modo captura y aéreo
            if (integrationsActive.avsis) {
                const safeAvsis = Array.isArray(avsisFields) ? avsisFields : [];
                fieldsToShow = [...fieldsToShow, ...safeAvsis];
                fieldGroups['Integración AVSIS'] = safeAvsis;
            }
            if (integrationsActive.gesintur) {
                const safeGesBillete = Array.isArray(gesinturBilleteFields) ? gesinturBilleteFields : [];
                const safeGesNormal = Array.isArray(gesinturNormalFields) ? gesinturNormalFields : [];
                fieldsToShow = [...fieldsToShow, ...safeGesBillete, ...safeGesNormal];
                fieldGroups['Gesintur (Billetaje)'] = safeGesBillete;
                fieldGroups['Gesintur (Normal)'] = safeGesNormal;
            }
            if (integrationsActive.orbisweb) {
                const safeOrbis = Array.isArray(pipelineOrbiswebFields) ? pipelineOrbiswebFields : [];
                fieldsToShow = [...fieldsToShow, ...safeOrbis];
                fieldGroups['Pipeline / ORBISWEB'] = safeOrbis;
            }
        } else {
            // Estructura para servicios NO aéreos en modo captura (Hotel, Rent a Car, Tren)
            fieldGroups = {
                'Información de Reserva': ['localizador', 'codigo_reserva', 'estado_booking', 'fecha_booking', 'proveedor', 'forma_pago'],
                'Detalles del Servicio': specificFields,
                'Precios e Impuestos': ['precio', 'divisa', 'imp_total_coste', 'imp_total_venta', 'imp_mark_up', 'imp_tasas', 'imp_total_tasas', 'imp_fee_servicio'],
                'Otros': []
            };

            // Lógica para Tren Solo Ida (Opcional, si quieres aplicarlo también a trenes)
            if (serviceType === 'tren' && isOneWay) {
                const returnFieldsTren = ['operador_tren_vuelta', 'num_tren_vuelta', 'estacion_origen_vuelta', 'fecha_vuelta', 'hora_salida_vuelta', 'estacion_destino_vuelta', 'hora_llegada_vuelta'];
                fieldsToShow = fieldsToShow.filter(f => !returnFieldsTren.includes(f));
                // Nota: Aquí tendrías que haber definido un grupo 'Vuelo de Vuelta' o similar para borrarlo.
            }
        }
    }

    // 3. Validar si hay algo que mostrar
    if (fieldsToShow.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.className = 'status-text';
        emptyMsg.textContent = 'No hay campos disponibles para este modo o servicio.';
        container.appendChild(emptyMsg);
        return;
    }
    
    // --- 4. CÁLCULO DE PROGRESO (Basado en la lista FILTRADA) ---
    const totalFields = fieldsToShow.length;
    const mappedCount = fieldsToShow.filter(f => currentMappings.hasOwnProperty(f)).length;
    const progressPercent = totalFields > 0 ? (mappedCount / totalFields) * 100 : 0;
    
    const progressDiv = document.getElementById('mappingProgress');
    const progressBar = document.getElementById('mappingProgressBar');
    const progressText = document.getElementById('mappingProgressText');
    
    if (progressDiv && progressBar && progressText) {
        progressDiv.style.display = 'block';
        progressBar.style.width = `${progressPercent}%`;
        progressText.textContent = `${mappedCount} / ${totalFields} campos mapeados (${Math.round(progressPercent)}%)`;
        
        // Color dinámico según porcentaje
        if (progressPercent === 100) progressBar.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        else if (progressPercent >= 50) progressBar.style.background = 'linear-gradient(90deg, #ffc107, #ff9800)';
        else progressBar.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
    }
    
    // --- 5. RENDERIZADO FINAL CON CONTROL DE UNICIDAD ---
    const renderedFields = new Set();

    Object.entries(fieldGroups).forEach(([groupName, groupList]) => {
        // Solo incluimos en el grupo los campos que están en la lista maestra fieldsToShow y no repetidos
        const fieldsInGroup = groupList.filter(f => fieldsToShow.includes(f) && !renderedFields.has(f));

        if (fieldsInGroup.length > 0) {
            const groupUI = createGroupUI(groupName, fieldsInGroup);
            container.appendChild(groupUI);
            fieldsInGroup.forEach(f => renderedFields.add(f));
        }
    });

    // Gestionar campos huérfanos (campos en fieldsToShow que no entraron en ningún grupo definido)
    const leftovers = fieldsToShow.filter(f => !renderedFields.has(f));
    if (leftovers.length > 0) {
        const leftoversUI = createGroupUI('Otros Campos Adicionales', leftovers);
        container.appendChild(leftoversUI);
    }
    
    // --- 6. RE-SINCRONIZAR LISTENERS DE CHECKBOXES (BATCH MODE) ---
    document.querySelectorAll('.batch-select-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const fieldDiv = cb.closest('.mapping-field-item');
            if (fieldDiv) {
                const isMapped = currentMappings.hasOwnProperty(cb.dataset.fieldName);
                fieldDiv.style.background = cb.checked ? '#e6f7ff' : (isMapped ? '#e6ffe6' : '#fff');
            }
            if (typeof updateMapSelectedButton === 'function') updateMapSelectedButton();
            if (typeof updateFindAIButton === 'function') updateFindAIButton();
            if (typeof updateSelectAllCheckbox === 'function') updateSelectAllCheckbox();
        });
    });

    // 7. Notificar cambio de tamaño al iframe para que se ajuste al contenido
    if (typeof notifySizeChange === 'function') {
        notifySizeChange();
    }
}

/**
 * Crea la interfaz de usuario para un grupo de campos.
 * @param {string} groupName - Nombre del grupo (ej: "Vuelo de Ida").
 * @param {Array} fields - Lista de slugs de campos a incluir en este grupo.
 * @returns {HTMLElement} El elemento div del grupo construido.
 */
function createGroupUI(groupName, fields) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'mapping-group';
    groupDiv.style.marginBottom = '20px';

    // --- CABECERA DEL GRUPO ---
    const groupHeader = document.createElement('div');
    groupHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
    
    const groupTitle = document.createElement('h4');
    groupTitle.textContent = groupName;
    groupTitle.style.cssText = 'margin: 0; font-size: 14px; color: #0672ff; font-weight: bold;';
    
    // Calcular estadísticas del grupo
    const groupMapped = fields.filter(f => currentMappings.hasOwnProperty(f)).length;
    const groupStats = document.createElement('span');
    groupStats.textContent = `${groupMapped}/${fields.length}`;
    groupStats.style.cssText = 'font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 8px; border-radius: 10px;';
    
    groupHeader.appendChild(groupTitle);
    groupHeader.appendChild(groupStats);
    groupDiv.appendChild(groupHeader);

    // --- CONTENEDOR DE CAMPOS ---
    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'group-fields-container';

    fields.forEach(field => {
        const isMapped = currentMappings.hasOwnProperty(field);
        const mappingData = currentMappings[field];
        
        const fieldDiv = document.createElement('div');
        fieldDiv.className = `mapping-field-item ${isMapped ? 'mapped' : ''}`;
        fieldDiv.dataset.fieldName = field;
        fieldDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 10px; margin: 4px 0; border: 1px solid ${isMapped ? '#28a745' : '#ddd'}; border-radius: 4px; background: ${isMapped ? '#e6ffe6' : '#fff'}; transition: all 0.2s; cursor: pointer;`;
        
        // 1. Checkbox para selección múltiple
        const batchCheckbox = document.createElement('input');
        batchCheckbox.type = 'checkbox';
        batchCheckbox.className = 'batch-select-checkbox';
        batchCheckbox.dataset.fieldName = field;
        const batchSelectModeActive = document.getElementById('batchSelectMode')?.checked;
        batchCheckbox.style.cssText = `margin-right: 8px; cursor: pointer; display: ${batchSelectModeActive ? 'block' : 'none'};`;
        
        fieldDiv.appendChild(batchCheckbox);
        
        // Listener para el click en toda la fila (Toggle selección o Iniciar mapeo)
        fieldDiv.addEventListener('click', (e) => {
            const batchSelectMode = document.getElementById('batchSelectMode');
            if (batchSelectMode && batchSelectMode.checked && e.target !== batchCheckbox && e.target.tagName !== 'BUTTON') {
                batchCheckbox.checked = !batchCheckbox.checked;
                fieldDiv.style.background = batchCheckbox.checked ? '#e6f7ff' : (isMapped ? '#e6ffe6' : '#fff');
                updateMapSelectedButton();
                updateFindAIButton();
            } else if (!batchSelectMode || !batchSelectMode.checked) {
                // Si no hay modo batch, clickear la fila inicia el mapeo si no está mapeado
                if (e.target !== batchCheckbox && e.target.tagName !== 'BUTTON' && !isMapped) {
                    startMapping(field);
                }
            }
        });
        
        // 2. Contenedor de etiquetas (Nombre y Slug)
        const fieldLabelContainer = document.createElement('div');
        fieldLabelContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; min-width: 0;';
        
        const fieldLabelSpanish = document.createElement('span');
        fieldLabelSpanish.textContent = getFieldLabel(field); // Usa tu función de traducción
        fieldLabelSpanish.style.cssText = 'font-weight: bold; color: #333; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        fieldLabelContainer.appendChild(fieldLabelSpanish);
        
        const fieldLabelTechnical = document.createElement('span');
        fieldLabelTechnical.textContent = field;
        fieldLabelTechnical.style.cssText = 'font-size: 11px; color: #666; font-style: italic;';
        fieldLabelContainer.appendChild(fieldLabelTechnical);
        
        // Mostrar preview del selector si ya existe
        if (isMapped && mappingData && mappingData.selector_path) {
            const selectorPreview = document.createElement('span');
            selectorPreview.textContent = mappingData.selector_path.length > 40 ? mappingData.selector_path.substring(0, 40) + '...' : mappingData.selector_path;
            selectorPreview.style.cssText = 'font-size: 10px; color: #888; font-family: monospace; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            selectorPreview.title = mappingData.selector_path;
            fieldLabelContainer.appendChild(selectorPreview);
        }
        
        fieldDiv.appendChild(fieldLabelContainer);
        
        // 3. Contenedor de Botones de Acción
        const actionsContainer = document.createElement('div');
        actionsContainer.style.cssText = 'display: flex; gap: 4px; align-items: center; flex-shrink: 0;';
        
        if (isMapped) {
            // Botón Ver/Editar
            const viewBtn = document.createElement('button');
            viewBtn.innerHTML = '👁️';
            viewBtn.title = 'Ver/Editar mapeo';
            viewBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #17a2b8; border: none; color: white; border-radius: 4px; cursor: pointer;';
            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                viewEditMapping(field, mappingData);
            });
            actionsContainer.appendChild(viewBtn);
            
            // Botón Probar
            const testBtn = document.createElement('button');
            testBtn.innerHTML = '✓';
            testBtn.title = 'Probar selector';
            testBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #6c757d; border: none; color: white; border-radius: 4px; cursor: pointer;';
            testBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                testSelector(field, mappingData);
            });
            actionsContainer.appendChild(testBtn);
            
            // Botón Eliminar
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = 'Eliminar mapeo';
            deleteBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #dc3545; border: none; color: white; border-radius: 4px; cursor: pointer;';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteMapping(field);
            });
            actionsContainer.appendChild(deleteBtn);
        } else {
            // Botón IA
            const aiBtn = document.createElement('button');
            aiBtn.innerHTML = '🤖 IA';
            aiBtn.title = 'Usar IA para encontrar selector';
            aiBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #9c27b0; border: none; color: white; border-radius: 4px; cursor: pointer;';
            aiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                findSelectorWithAI(field);
            });
            actionsContainer.appendChild(aiBtn);
            
            // Botón Map Manual
            const mapBtn = document.createElement('button');
            mapBtn.textContent = 'Map';
            mapBtn.style.cssText = 'padding: 4px 12px; font-size: 12px; background-color: #0672ff; border: none; color: white; border-radius: 4px; cursor: pointer;';
            mapBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startMapping(field);
            });
            actionsContainer.appendChild(mapBtn);
        }
        
        fieldDiv.appendChild(actionsContainer);
        fieldsContainer.appendChild(fieldDiv);
    });

    groupDiv.appendChild(fieldsContainer);
    return groupDiv;
}

function updateBatchSelectMode() {
    const batchSelectMode = document.getElementById('batchSelectMode');
    document.querySelectorAll('.batch-select-checkbox').forEach(cb => {
        cb.style.display = batchSelectMode.checked ? 'block' : 'none';
    });
}

function updateMapSelectedButton() {
    const batchSelectMode = document.getElementById('batchSelectMode');
    const mapSelectedBtn = document.getElementById('mapSelectedBtn');
    
    if (!batchSelectMode || !mapSelectedBtn) return;
    
    const checkedBoxes = document.querySelectorAll('.batch-select-checkbox:checked');
    const unmappedFields = Array.from(checkedBoxes).filter(cb => !currentMappings.hasOwnProperty(cb.dataset.fieldName));
    
    if (batchSelectMode.checked && unmappedFields.length > 0) {
        mapSelectedBtn.style.display = 'block';
        mapSelectedBtn.textContent = `🗺️ Mapear ${unmappedFields.length} Campo(s) Seleccionado(s)`;
    } else {
        mapSelectedBtn.style.display = 'none';
    }
}

function updateFindAIButton() {
    const batchSelectMode = document.getElementById('batchSelectMode');
    const findAIBtn = document.getElementById('findAIForSelectedBtn');
    
    if (!batchSelectMode || !findAIBtn) return;
    
    const checkedBoxes = document.querySelectorAll('.batch-select-checkbox:checked');
    
    if (batchSelectMode.checked && checkedBoxes.length > 0) {
        findAIBtn.style.display = 'block';
        findAIBtn.textContent = `🤖 Buscar con IA (${checkedBoxes.length} campo${checkedBoxes.length > 1 ? 's' : ''})`;
    } else {
        findAIBtn.style.display = 'none';
    }
}

// Función para manejar "Seleccionar Todos"
function handleSelectAllFields() {
    const selectAllCheckbox = document.getElementById('selectAllFields');
    const batchSelectMode = document.getElementById('batchSelectMode');
    
    if (!selectAllCheckbox || !batchSelectMode) return;
    
    // Solo funciona si el modo de selección múltiple está activo
    if (!batchSelectMode.checked) {
        selectAllCheckbox.checked = false;
        showStatus('Activa primero el "Modo Selección Múltiple"', 'info');
        return;
    }
    
    const allCheckboxes = document.querySelectorAll('.batch-select-checkbox');
    const isChecked = selectAllCheckbox.checked;
    
    allCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const fieldDiv = cb.closest('.mapping-field-item');
        if (fieldDiv) {
            const isMapped = currentMappings.hasOwnProperty(cb.dataset.fieldName);
            fieldDiv.style.background = isChecked ? '#e6f7ff' : (isMapped ? '#e6ffe6' : '#fff');
        }
    });
    
    updateMapSelectedButton();
    updateFindAIButton();
}

// Función para actualizar el estado del checkbox "Seleccionar Todos"
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllFields');
    const batchSelectMode = document.getElementById('batchSelectMode');
    
    if (!selectAllCheckbox || !batchSelectMode) return;
    
    // Si el modo de selección múltiple no está activo, desactivar y ocultar el checkbox
    if (!batchSelectMode.checked) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.disabled = true;
        selectAllCheckbox.style.opacity = '0.5';
        return;
    }
    
    // Habilitar el checkbox
    selectAllCheckbox.disabled = false;
    selectAllCheckbox.style.opacity = '1';
    
    // Verificar si todos los campos están seleccionados
    const allCheckboxes = document.querySelectorAll('.batch-select-checkbox');
    const checkedBoxes = document.querySelectorAll('.batch-select-checkbox:checked');
    
    if (allCheckboxes.length === 0) {
        selectAllCheckbox.checked = false;
        return;
    }
    
    // Si todos están seleccionados, marcar el checkbox "Seleccionar Todos"
    selectAllCheckbox.checked = allCheckboxes.length === checkedBoxes.length;
}

// Start mapping process
async function startMapping(fieldName) {
    if (!currentTabId) {
        showStatus('No hay pestaña activa', 'error');
        return;
    }
    
    const domain = document.getElementById('mappingDomain').value.trim();
    const fieldType = document.getElementById('mappingType').value;
    const serviceType = document.getElementById('mappingServiceType').value;
    const isOneWay = document.getElementById('isOneWay').checked; 
    
    if (!domain) {
        showStatus('Por favor ingresa un dominio', 'error');
        return;
    }
    let finalServiceType = serviceType;
    if (isOneWay && (serviceType === 'aereo' || serviceType === 'tren')) {
        finalServiceType = `${serviceType}_oneway`;
    }
    
    try {
        // Asegurar que el content script esté inyectado antes de enviar el mensaje
        await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            files: ['contentScript.js']
        });
        console.log('MAPPING: Content script inyectado correctamente');
        
        // Enviar mensaje al content script para iniciar modo de selección
        chrome.tabs.sendMessage(currentTabId, {
            action: 'startMapping',
            fieldName: fieldName,
            fieldType: fieldType,
            domain: domain,
            serviceType: finalServiceType,
            label: getFieldLabel(fieldName), 
            description: getFieldDescription(fieldName) 
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('MAPPING: Error enviando mensaje:', chrome.runtime.lastError);
                showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
            } else {
                showStatus(`Modo selección activado. Haz clic en el elemento de la página para mapear "${getFieldLabel(fieldName)}"`, 'info');
            }
        });
    } catch (error) {
        console.error('MAPPING: Error inyectando content script:', error);
        showStatus(`Error: No se pudo inyectar el script en la página. ${error.message}`, 'error');
    }
}

// NUEVA FUNCIÓN: Usar IA para encontrar selector
// NUEVA FUNCIÓN: Buscar selectores con IA para múltiples campos
async function findAllSelectorsWithAI() {
    if (!currentTabId) {
        showStatus('No hay pestaña activa', 'error');
        return;
    }
    
    const domain = document.getElementById('mappingDomain').value.trim();
    const fieldType = document.getElementById('mappingType').value;
    const apiKey = await getApiKey();
    
    if (!domain) {
        showStatus('Por favor ingresa un dominio', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus('Por favor ingresa tu API Key', 'error');
        return;
    }
    
    // Obtener campos seleccionados
    const checkedBoxes = document.querySelectorAll('.batch-select-checkbox:checked');
    const selectedFields = Array.from(checkedBoxes).map(cb => cb.dataset.fieldName);
    
    if (selectedFields.length === 0) {
        showStatus('Por favor selecciona al menos un campo', 'error');
        return;
    }
    
    showStatus(`Buscando selectores para ${selectedFields.length} campo(s) con IA...`, 'info');
    showAISearchProgress(
        `Buscando selectores para ${selectedFields.length} campo(s) con IA...`,
        'Analizando la página y encontrando los mejores selectores...'
    );
    
    try {
        // Obtener HTML de la página actual
        const htmlResult = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: () => {
                // Limpiar HTML similar a como se hace en background.js
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
        
        const cleanedHtml = htmlResult[0]?.result;
        if (!cleanedHtml) {
            throw new Error('No se pudo obtener el HTML de la página');
        }
        
        // Llamar a la API para que la IA encuentre los selectores de todos los campos
        console.log(`[MAPPING] Enviando peticion para ${selectedFields.length} campos`);
        console.log(`[MAPPING] Tamano HTML: ${(cleanedHtml.length / 1024).toFixed(2)} KB`);
        const requestStartTime = Date.now();
        
        const response = await chrome.runtime.sendMessage({
            action: 'findSelectorsWithAI',
            apiKey: apiKey,
            fieldNames: selectedFields,
            domain: domain,
            fieldType: fieldType,
            html: cleanedHtml
        });
        
        const requestElapsedTime = Date.now() - requestStartTime;
        console.log(`[MAPPING] Respuesta recibida en ${requestElapsedTime}ms`);
        console.log(`[MAPPING] Status: ${response?.status}`);
        console.log(`[MAPPING] Selectores encontrados: ${response?.selectors ? Object.keys(response.selectors).length : 0}`);
        
        if (response && response.status === 'success' && response.selectors) {
            const foundCount = response.found || Object.keys(response.selectors).length;
            const totalCount = response.total || selectedFields.length;
            
            let statusMessage = `Selectores encontrados para ${foundCount} de ${totalCount} campo(s)`;
            if (response.errors && Object.keys(response.errors).length > 0) {
                statusMessage += `. ${Object.keys(response.errors).length} campo(s) con errores.`;
            }
            showStatus(statusMessage, foundCount > 0 ? 'success' : 'warning');
            
            // Mostrar los resultados directamente en la ventana de mapeo
            displayAISelectorsInMappingWindow(response.selectors, domain, fieldType, response.errors);
        } else {
            showStatus(response?.message || 'No se pudieron encontrar los selectores con IA', 'error');
        }
    } catch (error) {
        console.error('Error buscando selectores con IA:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        // Ocultar el indicador de progreso cuando termine (éxito o error)
        hideAISearchProgress();
    }
}

// Función para mostrar los selectores encontrados por IA en la ventana de mapeo
function displayAISelectorsInMappingWindow(selectors, domain, fieldType, errors = {}) {
    const fieldsContainer = document.getElementById('mappingFieldsContainer');
    if (!fieldsContainer) return;

    // 1. Limpiar resultados previos de la IA si existen para no duplicar la caja azul
    const existingResults = document.getElementById('aiSelectorsResults');
    if (existingResults) {
        existingResults.remove();
    }

    // 2. Crear el contenedor principal (La caja azul)
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'aiSelectorsResults';
    resultsContainer.style.cssText = `
        margin-top: 10px; 
        margin-bottom: 25px; 
        padding: 15px; 
        background: #f0f7ff; 
        border: 2px solid #0672ff; 
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    `;

    // --- SECCIÓN: CABECERA (Título y Botón Guardar Todo) ---
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #b3d7ff; padding-bottom: 10px;';
    
    const foundCount = Object.keys(selectors).length;
    const errorCount = Object.keys(errors).length;
    
    const resultsTitle = document.createElement('h3');
    resultsTitle.textContent = `🤖 IA: ${foundCount} Encontrados ${errorCount > 0 ? `(${errorCount} Errores)` : ''}`;
    resultsTitle.style.cssText = 'margin: 0; color: #0672ff; font-size: 15px; font-weight: bold;';
    
    const headerActions = document.createElement('div');
    headerActions.style.display = 'flex';
    headerActions.style.gap = '10px';

    // Botón Guardar Todo
    if (foundCount > 0) {
        const saveAllBtn = document.createElement('button');
        saveAllBtn.id = 'saveAllAISelectorsBtn';
        saveAllBtn.innerHTML = '💾 Guardar Todo';
        saveAllBtn.style.cssText = 'width: auto; padding: 6px 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
        saveAllBtn.addEventListener('click', () => saveAllAISelectors(selectors, domain, fieldType));
        headerActions.appendChild(saveAllBtn);
    }

    // Botón Cerrar
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background: none; border: none; font-size: 18px; cursor: pointer; color: #666; padding: 0 5px;';
    closeBtn.addEventListener('click', () => resultsContainer.remove());
    headerActions.appendChild(closeBtn);

    headerDiv.appendChild(resultsTitle);
    headerDiv.appendChild(headerActions);
    resultsContainer.appendChild(headerDiv);

    // --- SECCIÓN: ERRORES ---
    if (errorCount > 0) {
        const errorsDiv = document.createElement('div');
        errorsDiv.style.cssText = 'margin-bottom: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; font-size: 11px; color: #856404;';
        errorsDiv.innerHTML = '<strong>⚠️ Campos no encontrados por la IA:</strong>';
        
        Object.entries(errors).forEach(([fieldName, error]) => {
            const errorItem = document.createElement('div');
            errorItem.style.margin = '3px 0';
            errorItem.textContent = `• ${getFieldLabel(fieldName)}: ${error}`;
            errorsDiv.appendChild(errorItem);
        });
        resultsContainer.appendChild(errorsDiv);
    }

    // --- SECCIÓN: LISTA DE CAMPOS ---
    const resultsList = document.createElement('div');
    resultsList.id = 'aiFieldsScrollList';
    resultsList.style.cssText = 'max-height: 450px; overflow-y: auto; padding-right: 5px;';

    Object.entries(selectors).forEach(([fieldName, selectorData]) => {
        const fieldDiv = document.createElement('div');
        fieldDiv.id = `ai-row-${fieldName}`;
        fieldDiv.style.cssText = 'margin-bottom: 12px; padding: 12px; background: white; border-radius: 6px; border: 1px solid #ddd; transition: all 0.3s;';

        const fieldLabel = document.createElement('div');
        fieldLabel.style.cssText = 'font-weight: bold; color: #333; margin-bottom: 8px; font-size: 13px; display: flex; justify-content: space-between;';
        fieldLabel.innerHTML = `<span>${getFieldLabel(fieldName)}</span><span style="font-size: 10px; color: #999; font-weight: normal;">${fieldName}</span>`;
        fieldDiv.appendChild(fieldLabel);

        // Input de Selector
        const selectorInput = document.createElement('input');
        selectorInput.type = 'text';
        selectorInput.id = `ai-sel-${fieldName}`;
        selectorInput.value = selectorData.selector || selectorData.selector_path || '';
        selectorInput.style.cssText = 'width: 100%; padding: 6px; font-family: monospace; font-size: 11px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 8px;';
        fieldDiv.appendChild(selectorInput);

        // Contenedor de Método y Botones
        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        const methodSelect = document.createElement('select');
        methodSelect.id = `ai-met-${fieldName}`;
        methodSelect.style.cssText = 'flex: 1; padding: 5px; font-size: 11px; border: 1px solid #ccc; border-radius: 4px;';
        ['textContent', 'value', 'innerText', 'data-value', 'data-id'].forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === (selectorData.extraction_method || 'textContent')) opt.selected = true;
            methodSelect.appendChild(opt);
        });
        controlsDiv.appendChild(methodSelect);

        // Botón Probar
        const testBtn = document.createElement('button');
        testBtn.textContent = 'Probar';
        testBtn.style.cssText = 'padding: 5px 10px; font-size: 11px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;';
        testBtn.addEventListener('click', () => {
            testAISelector(fieldName, selectorInput.value, methodSelect.value);
        });
        controlsDiv.appendChild(testBtn);

        // Botón Guardar Individual
        const saveBtn = document.createElement('button');
        saveBtn.id = `ai-save-btn-${fieldName}`;
        saveBtn.textContent = 'Guardar';
        saveBtn.style.cssText = 'padding: 5px 10px; font-size: 11px; background: #0672ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        saveBtn.addEventListener('click', () => {
            saveAISelector(fieldName, selectorInput.value, methodSelect.value, domain, fieldType);
        });
        controlsDiv.appendChild(saveBtn);

        fieldDiv.appendChild(controlsDiv);

        // Valor de ejemplo
        if (selectorData.preview_value) {
            const preview = document.createElement('div');
            preview.style.cssText = 'margin-top: 8px; font-size: 10px; color: #28a745; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
            preview.textContent = `Ejemplo: "${selectorData.preview_value}"`;
            fieldDiv.appendChild(preview);
        }

        resultsList.appendChild(fieldDiv);
    });

    resultsContainer.appendChild(resultsList);

    // 3. Inserción: Poner la caja al principio (encima de la lista general)
    fieldsContainer.prepend(resultsContainer);
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveAllAISelectors(selectors, domain, fieldType) {
    const apiKey = await getApiKey();
    const saveAllBtn = document.getElementById('saveAllAISelectorsBtn');
    const serviceType = document.getElementById('mappingServiceType').value;
    if (!confirm(`¿Deseas guardar los ${Object.keys(selectors).length} campos encontrados?`)) return;

    saveAllBtn.disabled = true;
    saveAllBtn.textContent = '⏳ Guardando lote...';

    const fields = Object.keys(selectors);
    let successCount = 0;

    // Procesar secuencialmente para evitar saturar el servidor
    for (const fieldName of fields) {
        const sel = document.getElementById(`ai-sel-${fieldName}`).value;
        const met = document.getElementById(`ai-met-${fieldName}`).value;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'saveFieldSelector',
                apiKey: apiKey,
                payload: {
                    domain: domain,
                    field_name: fieldName,
                    field_type: fieldType || 'capture',
                    service_type: serviceType,
                    selector_path: sel,
                    selector_type: 'hierarchical',
                    extraction_method: met
                }
            });

            if (response && response.status === 'success') {
                markAIRowAsSaved(fieldName);
                successCount++;
            }
        } catch (e) {
            console.error(`Error guardando masivo ${fieldName}:`, e);
        }
    }

    saveAllBtn.textContent = '✅ Finalizado';
    showStatus(`Se guardaron ${successCount} campos con éxito.`, 'success');
    
    // Recargar la lista principal de fondo para mostrar los campos en verde
    if (typeof loadMappings === 'function') loadMappings();
}

/**
 * Helper visual: Marca una fila como guardada.
 */
function markAIRowAsSaved(fieldName) {
    const row = document.getElementById(`ai-row-${fieldName}`);
    if (row) {
        row.style.background = '#e6ffe6';
        row.style.borderColor = '#28a745';
        row.style.opacity = '0.8';
        const btn = document.getElementById(`ai-save-btn-${fieldName}`);
        if (btn) {
            btn.textContent = '✓';
            btn.style.background = '#28a745';
            btn.disabled = true;
        }
    }
}

// Función para probar un selector encontrado por IA
async function testAISelector(fieldName, selector, extractionMethod) {
    if (!currentTabId) {
        showStatus('No hay pestaña activa', 'error');
        return;
    }
    
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: (sel, method) => {
                try {
                    const element = document.querySelector(sel);
                    if (!element) {
                        return { success: false, error: 'Elemento no encontrado', value: null };
                    }
                    
                    let value = '';
                    if (method === 'value') {
                        value = element.value || '';
                    } else if (method === 'textContent' || method === 'innerText') {
                        value = element.textContent?.trim() || element.innerText?.trim() || '';
                    } else if (method.startsWith('data-')) {
                        const attrName = method.replace('data-', '');
                        value = element.getAttribute(`data-${attrName}`) || '';
                    } else {
                        value = element.textContent?.trim() || '';
                    }
                    
                    return { success: true, value: value, tagName: element.tagName };
                } catch (e) {
                    return { success: false, error: e.message, value: null };
                }
            },
            args: [selector, extractionMethod]
        });
        
        const testResult = result[0]?.result;
        if (testResult && testResult.success) {
            showStatus(`✓ Selector válido. Valor encontrado: "${testResult.value}"`, 'success');
        } else {
            showStatus(`✗ Error: ${testResult?.error || 'Selector inválido'}`, 'error');
        }
    } catch (error) {
        showStatus(`Error probando selector: ${error.message}`, 'error');
    }
}

// Función para guardar un selector encontrado por IA
async function saveAISelector(fieldName, selector, extractionMethod, domain, fieldType) {
    const apiKey = await getApiKey();
    
    if (!apiKey) {
        showStatus('Por favor ingresa tu API Key', 'error');
        return;
    }
    
    if (!selector) {
        showStatus('El selector no puede estar vacío', 'error');
        return;
    }
    const serviceType = document.getElementById('mappingServiceType').value;
    const isOneWay = document.getElementById('isOneWay').checked;
    let finalServiceType = serviceType;
    if (isOneWay && (serviceType === 'aereo' || serviceType === 'tren')) {
        finalServiceType = `${serviceType}_oneway`;
    }
    const payload = {
        domain: domain,
        field_name: fieldName,
        field_type: fieldType || 'capture',
        service_type: finalServiceType,
        selector_path: selector,
        selector_type: 'hierarchical', // Guardado jerárquico
        extraction_method: extractionMethod || 'textContent'
    };
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'saveFieldSelector',
            apiKey: apiKey,
            payload: payload
        });
        
        if (response && response.status === 'success') {
            showStatus(`✓ Mapeo guardado para "${getFieldLabel(fieldName)}"`, 'success');
            // Recargar mapeos
            await loadMappings();
        } else {
            showStatus(response?.message || 'Error guardando el mapeo', 'error');
        }
    } catch (error) {
        console.error('Error saving selector:', error);
        showStatus(`Error: ${error.message}`, 'error');
    }
}

async function findSelectorWithAI(fieldName) {
    if (!currentTabId) {
        showStatus('No hay pestaña activa', 'error');
        return;
    }
    
    const domain = document.getElementById('mappingDomain').value.trim();
    const fieldType = document.getElementById('mappingType').value;
    const apiKey = await getApiKey();
    
    if (!domain) {
        showStatus('Por favor ingresa un dominio', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus('Por favor ingresa tu API Key', 'error');
        return;
    }
    
    showStatus(`Buscando selector para "${getFieldLabel(fieldName)}" con IA...`, 'info');
    showAISearchProgress(
        `Buscando selector para "${getFieldLabel(fieldName)}" con IA...`,
        'Analizando la página y encontrando el mejor selector...'
    );
    
    try {
        // Obtener HTML de la página actual
        const htmlResult = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: () => {
                // Limpiar HTML similar a como se hace en background.js
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
        
        const cleanedHtml = htmlResult[0]?.result;
        if (!cleanedHtml) {
            throw new Error('No se pudo obtener el HTML de la página');
        }
        
        // Llamar a la API para que la IA encuentre el selector
        const response = await chrome.runtime.sendMessage({
            action: 'findSelectorWithAI',
            apiKey: apiKey,
            fieldName: fieldName,
            domain: domain,
            fieldType: fieldType,
            html: cleanedHtml
        });
        
        if (response && response.status === 'success' && response.selector) {
            showStatus(`Selector encontrado: ${response.selector}`, 'success');
            
            // Crear el mapeo directamente con el selector encontrado
            const mappingData = {
                fieldName: fieldName,
                fieldType: fieldType,
                domain: domain,
                selector: response.selector,
                selectorType: response.selector_type || 'text',
                extractionMethod: response.extraction_method || 'textContent',
                previewValue: response.preview_value || ''
            };
            
            // Enviar al content script para mostrar el popup flotante
            chrome.tabs.sendMessage(currentTabId, {
                action: 'showAIFoundSelector',
                mappingData: mappingData
            });
        } else {
            showStatus(response?.message || 'No se pudo encontrar el selector con IA', 'error');
        }
    } catch (error) {
        console.error('Error buscando selector con IA:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        // Ocultar el indicador de progreso cuando termine (éxito o error)
        hideAISearchProgress();
    }
}

// Map selected fields
function mapSelectedFields() {
    const checkboxes = document.querySelectorAll('.batch-select-checkbox:checked');
    if (checkboxes.length === 0) {
        showStatus('Por favor selecciona al menos un campo', 'error');
        return;
    }
    
    const quickMode = document.getElementById('quickMappingMode').checked;
    const fields = Array.from(checkboxes).map(cb => cb.dataset.fieldName);
    
    if (quickMode) {
        // Modo rápido: mapea los campos en secuencia uno tras otro
        startQuickMappingSequence(fields);
    } else {
        // Sin modo rápido: solo mapea el primer campo
        // (no tiene sentido mapear todos a la vez porque solo puedes hacer clic en un elemento)
        if (fields.length > 1) {
            showStatus(`Se mapeará el primer campo. Para mapear ${fields.length} campos en secuencia, activa el "Modo Mapeo Rápido"`, 'info');
        }
        startMapping(fields[0]);
    }
}

function startQuickMappingSequence(fields) {
    if (fields.length === 0) return;
    
    let currentIndex = 0;
    
    const mapNext = () => {
        if (currentIndex >= fields.length) {
            showStatus('Todos los campos han sido mapeados', 'success');
            return;
        }
        
        startMapping(fields[currentIndex]);
        currentIndex++;
    };
    
    // Listen for mapping completion
    const listener = (request) => {
        if (request.action === 'mappingCompleted') {
            setTimeout(() => {
                mapNext();
            }, 500);
        }
    };
    
    chrome.runtime.onMessage.addListener(listener);
    mapNext();
}

// View/Edit existing mapping
function viewEditMapping(fieldName, mappingData) {
    // For now, just show info - the floating popup will handle editing
    alert(`Mapeo para ${getFieldLabel(fieldName)}:\nSelector: ${mappingData.selector_path}\nMétodo: ${mappingData.extraction_method}`);
}

// Test selector
async function testSelector(fieldName, mappingData) {
    if (!currentTabId) {
        showStatus('No hay pestaña activa', 'error');
        return;
    }
    
    showStatus('Probando selector...', 'info');
    
    try {
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            func: (selectorPath, extractionMethod) => {
                try {
                    const element = document.querySelector(selectorPath);
                    if (!element) {
                        return { success: false, error: 'Elemento no encontrado', value: null };
                    }
                    
                    let value = '';
                    if (extractionMethod === 'value') {
                        value = element.value || '';
                    } else if (extractionMethod === 'textContent' || extractionMethod === 'innerText') {
                        value = element.textContent?.trim() || element.innerText?.trim() || '';
                    } else if (extractionMethod.startsWith('data-')) {
                        const attrName = extractionMethod.replace('data-', '');
                        value = element.getAttribute(`data-${attrName}`) || '';
                    } else {
                        value = element.textContent?.trim() || '';
                    }
                    
                    return { success: true, value: value, tagName: element.tagName };
                } catch (e) {
                    return { success: false, error: e.message, value: null };
                }
            },
            args: [mappingData.selector_path, mappingData.extraction_method || 'textContent']
        });
        
        const result = injectionResults[0]?.result;
        
        if (result && result.success) {
            showStatus(`✓ Selector funciona! Valor encontrado: "${result.value.substring(0, 50)}${result.value.length > 50 ? '...' : ''}"`, 'success');
        } else {
            showStatus(`✗ Selector falló: ${result?.error || 'Error desconocido'}`, 'error');
        }
    } catch (error) {
        console.error('Error testing selector:', error);
        showStatus(`Error probando selector: ${error.message}`, 'error');
    }
}

// Delete mapping
async function deleteMapping(fieldName) {
    const domain = document.getElementById('mappingDomain').value.trim();
    const serviceType = document.getElementById('mappingServiceType').value;
    const apiKey = await getApiKey();
    
    if (!domain) {
        showStatus('Por favor ingresa un dominio', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus('Por favor ingresa tu API Key', 'error');
        return;
    }
    
    if (!confirm(`¿Estás seguro de que quieres eliminar el mapeo para "${getFieldLabel(fieldName)}"?`)) {
        return;
    }
    
    try {
        const fieldType = document.getElementById('mappingType').value;
        const isOneWay = document.getElementById('isOneWay').checked;
        let finalServiceType = serviceType;
        if (isOneWay && (serviceType === 'aereo' || serviceType === 'tren')) {
            finalServiceType = `${serviceType}_oneway`;
        }
        const data = await chrome.runtime.sendMessage({
            action: 'deleteFieldSelector',
            apiKey: apiKey,
            domain: domain,
            fieldName: fieldName,
            fieldType: fieldType,
            serviceType: finalServiceType
        });
        
        if (data && data.status === 'success') {
            showStatus('Mapeo eliminado exitosamente', 'success');
            loadMappings();
        } else {
            // Fallback: Remove from local cache
            delete currentMappings[fieldName];
            renderMappingFields();
            showStatus(data?.message || 'Mapeo eliminado de caché local', 'info');
        }
    } catch (error) {
        console.error('Error deleting mapping:', error);
        // Fallback: Remove from local cache
        delete currentMappings[fieldName];
        renderMappingFields();
        showStatus('Mapeo eliminado de caché local', 'info');
    }
}
