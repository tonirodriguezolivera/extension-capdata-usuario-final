// Declarar variables de mapeo en window para evitar conflictos al reinyectar
// Usar window para que las variables persistan entre inyecciones
if (typeof window.capdataMappingVars === 'undefined') {
    window.capdataMappingVars = {
        isMappingMode: false,
        currentMappingField: null,
        currentMappingType: null,
        currentMappingDomain: null,
        mappingOverlay: null,
        highlightedElement: null,
        floatingPopup: null,
        floatingPopupMinimized: false
    };
}
// Crear alias para facilitar el uso (usando var para permitir redeclaración)
var isMappingMode = window.capdataMappingVars.isMappingMode;
var currentMappingField = window.capdataMappingVars.currentMappingField;
var currentMappingType = window.capdataMappingVars.currentMappingType;
var currentMappingDomain = window.capdataMappingVars.currentMappingDomain;
var mappingOverlay = window.capdataMappingVars.mappingOverlay;
var highlightedElement = window.capdataMappingVars.highlightedElement;
var floatingPopup = window.capdataMappingVars.floatingPopup;
var floatingPopupMinimized = window.capdataMappingVars.floatingPopupMinimized;

// Helper functions para sincronizar con window
function setMappingMode(value) { 
    window.capdataMappingVars.isMappingMode = value; 
    isMappingMode = value;
}
function setCurrentMappingField(value) { 
    window.capdataMappingVars.currentMappingField = value; 
    currentMappingField = value;
}
function setCurrentMappingType(value) { 
    window.capdataMappingVars.currentMappingType = value; 
    currentMappingType = value;
}
function setCurrentMappingDomain(value) { 
    window.capdataMappingVars.currentMappingDomain = value; 
    currentMappingDomain = value;
}
function setMappingOverlay(value) { 
    window.capdataMappingVars.mappingOverlay = value; 
    mappingOverlay = value;
}
function setHighlightedElement(value) { 
    window.capdataMappingVars.highlightedElement = value; 
    highlightedElement = value;
}
function setFloatingPopup(value) { 
    window.capdataMappingVars.floatingPopup = value; 
    floatingPopup = value;
}
function setFloatingPopupMinimized(value) { 
    window.capdataMappingVars.floatingPopupMinimized = value; 
    floatingPopupMinimized = value;
}

// Guard to prevent multiple injections
if (window.capdataContentScriptLoaded) {
    console.log('CapData content script already loaded, skipping re-injection');
} else {
    window.capdataContentScriptLoaded = true;

const IFRAME_ID = 'capdata-reserva-iframe';
const RESIZE_HANDLE_ID = 'capdata-resize-handle';
let iframe = null;
let resizeHandle = null;
let isResizing = false;
let startX, startY, startWidth, startHeight;

function createUI() {
    if (document.getElementById(IFRAME_ID)) {
        return; 
    }

    // Crear contenedor para el iframe y el handle de redimensionamiento
    const container = document.createElement('div');
    container.id = 'capdata-reserva-container';
    container.style.position = 'fixed';
    container.style.top = '10px';
    container.style.right = '10px';
    container.style.width = '700px';
    container.style.height = '800px';
    // Asegurar que no exceda la altura de la ventana (10px arriba + 10px abajo = 20px total)
    container.style.maxHeight = 'calc(100vh - 20px)';
    container.style.zIndex = '999999';
    container.style.border = '1px solid #ccc';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';
    container.style.backgroundColor = '#fff';

    iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = chrome.runtime.getURL('popup.html');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.flex = '1';
    iframe.style.minHeight = '0';
    iframe.style.overflow = 'auto'; // Permitir scroll si el contenido es más grande

    // Crear handle de redimensionamiento en la esquina inferior izquierda
    resizeHandle = document.createElement('div');
    resizeHandle.id = RESIZE_HANDLE_ID;
    resizeHandle.style.width = '24px';
    resizeHandle.style.height = '24px';
    resizeHandle.style.position = 'absolute';
    resizeHandle.style.bottom = '0';
    resizeHandle.style.left = '0';
    resizeHandle.style.cursor = 'nesw-resize';
    resizeHandle.style.backgroundColor = 'transparent';
    resizeHandle.style.borderBottomLeftRadius = '8px';
    resizeHandle.style.zIndex = '1000000';
    
    // Agregar icono visual para el handle usando líneas diagonales (espejado para esquina izquierda)
    resizeHandle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="position: absolute; bottom: 2px; left: 2px;"><path d="M0 16 L16 16 L0 0 Z" stroke="#666" stroke-width="1.5" fill="none"/><circle cx="4" cy="12" r="1" fill="#666"/></svg>';
    resizeHandle.style.display = 'flex';
    resizeHandle.style.alignItems = 'center';
    resizeHandle.style.justifyContent = 'center';
    resizeHandle.style.userSelect = 'none';
    resizeHandle.title = 'Arrastra para redimensionar';
    
    // Efecto hover sutil (solo el icono cambia de color, sin fondo)
    resizeHandle.addEventListener('mouseenter', () => {
        const svg = resizeHandle.querySelector('svg');
        if (svg) {
            svg.querySelector('path').setAttribute('stroke', '#333');
            svg.querySelector('circle').setAttribute('fill', '#333');
        }
    });
    resizeHandle.addEventListener('mouseleave', () => {
        if (!isResizing) {
            const svg = resizeHandle.querySelector('svg');
            if (svg) {
                svg.querySelector('path').setAttribute('stroke', '#666');
                svg.querySelector('circle').setAttribute('fill', '#666');
            }
        }
    });

    // Eventos para redimensionamiento
    resizeHandle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);

    container.appendChild(iframe);
    container.appendChild(resizeHandle);
    document.body.appendChild(container);
}

function startResize(e) {
    isResizing = true;
    const container = document.getElementById('capdata-reserva-container');
    startX = e.clientX;
    startY = e.clientY;
    startWidth = parseInt(window.getComputedStyle(container).width, 10);
    startHeight = parseInt(window.getComputedStyle(container).height, 10);
    e.preventDefault();
}

function doResize(e) {
    if (!isResizing) return;
    
    const container = document.getElementById('capdata-reserva-container');
    if (!container) return;

    // Como el handle está en la esquina inferior izquierda y el contenedor usa 'right':
    // - El ancho: cuando arrastras hacia la izquierda (deltaX negativo), el ancho aumenta
    // - La altura: cuando arrastras hacia abajo (deltaY positivo), la altura aumenta
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    // Para el ancho: si arrastras hacia la izquierda (deltaX negativo), el ancho aumenta
    // El right se mantiene fijo, así que solo cambiamos el ancho
    const newWidth = startWidth - deltaX; // Restamos porque arrastramos desde la izquierda
    const newHeight = startHeight + deltaY; // Sumamos porque arrastramos hacia abajo
    
    // Tamaños mínimos para evitar que se haga demasiado pequeño
    const minWidth = 400;
    const minHeight = 300;
    // Altura máxima: altura de ventana menos márgenes (10px arriba + 10px abajo)
    const maxHeight = window.innerHeight - 20;
    
    container.style.width = Math.max(minWidth, newWidth) + 'px';
    container.style.height = Math.max(minHeight, Math.min(newHeight, maxHeight)) + 'px';
    container.style.maxHeight = `${maxHeight}px`; // Asegurar que respete el máximo
}

function stopResize() {
    isResizing = false;
}

function destroyUI() {
    const container = document.getElementById('capdata-reserva-container');
    if (container) {
        container.remove();
        iframe = null;
        resizeHandle = null;
    }
}

function toggleUI() {
    const existingContainer = document.getElementById('capdata-reserva-container');
    if (existingContainer) {
        // Si ya existe, lo quitamos
        existingContainer.remove();
    } else {
        // Si no existe, lo creamos
        createUI();
    }
}

// Listener principal del Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleUI') {
        toggleUI();
        sendResponse({ status: 'ok' });
    }
    
    // Si necesitas que la UI se cierre desde adentro (p.ej. al hacer clic en un botón "Cerrar")
    if (request.action === 'closeUI') {
        const existingContainer = document.getElementById('capdata-reserva-container');
        if (existingContainer) existingContainer.remove();
        sendResponse({ status: 'closed' });
    }

    if (request.action === 'resizeIframe') {
        const container = document.getElementById('capdata-reserva-container');
        const iframe = document.getElementById(IFRAME_ID);
        if (container && iframe && !isResizing) {
            // Calcular la altura necesaria con padding adicional
            const contentHeight = request.height;
            const padding = 50; // Padding adicional para evitar cortes
            const newHeight = contentHeight + padding;
            const currentHeight = parseInt(window.getComputedStyle(container).height, 10);
            // Dejar márgenes: 10px arriba + 10px abajo = 20px total
            const maxHeight = window.innerHeight - 20; // Margen superior + inferior
            const minHeight = 300; // Altura mínima
            
            // Ajustar altura del contenedor para que muestre todo el contenido
            // Si el contenido es más grande que el contenedor, aumentar la altura
            // pero no más allá del máximo permitido
            const targetHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));
            
            // Siempre ajustar la altura del contenedor si el contenido cambió
            // Usar min para asegurar que no exceda el máximo
            const finalHeight = Math.min(targetHeight, maxHeight);
            container.style.height = `${finalHeight}px`;
            container.style.maxHeight = `${maxHeight}px`; // Asegurar que respete el máximo
            
            // El iframe siempre debe ocupar el 100% del contenedor
            // El scroll se manejará internamente si el contenido es más grande
            iframe.style.height = '100%';
        }
    }

    if (request.flightData) {
        console.log("=== Datos de Reservas de Vuelo recibidos en Content Script ===");
        console.log(request.flightData);
    }

    if (request.action === 'fillPageData') {
        fillForm(request.data, request.selectors)
            .then(fillReport => {
                sendResponse({ status: 'completed', report: fillReport });
            })
            .catch(error => {
                console.error("CONTENT: Error durante el rellenado:", error);
                sendResponse({ status: 'error', message: error.message });
            });
        return true; // Esencial para la respuesta asíncrona
    }

    // Manual Field Mapping System handlers
    if (request.action === 'startMapping') {
        console.log('CONTENT: Received startMapping request:', request);
        enterSelectionMode(
            request.fieldName, 
            request.fieldType, 
            request.domain, 
            request.label,
            request.description,
            request.serviceType
        );
        console.log('CONTENT: Entered selection mode, currentMappingField:', currentMappingField, 'currentMappingType:', currentMappingType, 'domain:', currentMappingDomain);
        sendResponse({ status: 'ok' });
        return true;
    }
    
    if (request.action === 'cancelMapping') {
        console.log("CONTENT: Cancelando mapeo por mensaje externo...");
        exitSelectionMode();
        
        // Limpieza extra del popup flotante si estuviera abierto
        const floating = document.getElementById('capdata-floating-mapping-popup');
        if (floating) floating.remove();
        
        const restore = document.getElementById('capdata-restore-floating-popup');
        if (restore) restore.remove();
        
        sendResponse({ status: 'ok' });
        return true;
    }
    
    if (request.action === 'showAIFoundSelector') {
        // Mostrar popup flotante con el selector encontrado por IA
        if (request.mappingData) {
            showFloatingMappingPopup(request.mappingData);
        }
        sendResponse({ status: 'ok' });
        return true;
    }

    return true; // Para respuestas asíncronas si las necesitas
});

function waitForElement(selector, timeout = 5000) {
    return new Promise(resolve => {
        // Primero, intentar encontrarlo inmediatamente
        const element = document.querySelector(selector);
        if (element) {
            return resolve(element);
        }

        const observer = new MutationObserver(mutations => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Timeout por si el elemento nunca aparece
        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}
// --- FIN DE LA FUNCIÓN HELPER 'waitForElement' ---

function escapeSelector(selector) {
    if (!selector) return null;
    return selector.replace(/([.\[\]])/g, '\\$1');
}
/**
 * Normaliza fechas de dd/mm/aaaa a otros formatos
 */
function formatBirthDate(dateStr, targetFormat = 'iso') {
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.includes('/')) return dateStr;
    
    const parts = dateStr.trim().split('/');
    if (parts.length !== 3) return dateStr;

    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];

    if (targetFormat === 'iso') {
        return `${year}-${month}-${day}`;
    }
    return `${day}/${month}/${year}`;
}

async function fillForm(data, selectors) {
    console.log("------------------- INICIANDO RELLENADO -------------------");
    console.log("1. Datos recibidos de la BD:", data);
    console.log("2. Selectores a aplicar:", selectors);

    if (!selectors) return { fields_found: 0, fields_attempted: 0 };

    const report = { fields_found: 0, fields_attempted: 0 };
    
    // Campos que se consideran clave para el reporte de éxito
    const keyFields = ['nombre_pax', 'primer_apellidos_pax', 'num_documento', 'genero_pax', 'fecha_nac', 'fecha_cumple_pax'];

    for (const dataKey of Object.keys(selectors)) {
        const selectorData = selectors[dataKey];
        let valueToFill = data[dataKey];

        // Ignorar si no hay valor o el valor es el string "NULL"
        if (valueToFill === undefined || valueToFill === null || valueToFill === "NULL" || !selectorData) continue;

        if (keyFields.includes(dataKey)) {
            report.fields_attempted++;
        }

        const mainSelector = typeof selectorData === 'object' ? selectorData.selector : selectorData;
        const escapedSelector = escapeSelector(mainSelector);
        
        // Esperar a que el elemento aparezca en el DOM
        const element = await waitForElement(escapedSelector);

        if (!element) {
            console.warn(`[${dataKey}] Elemento no encontrado para el selector: ${mainSelector}`);
            continue;
        }

        // --- LÓGICA DE DETECCIÓN Y FORMATEO DE FECHAS ---
        // Detectamos si es una fecha por el nombre de la clave o por el formato del valor (DD/MM/YYYY)
        const isDateKey = dataKey.toLowerCase().includes('fecha') || dataKey.toLowerCase().includes('date') || dataKey.toLowerCase().includes('dob');
        const isDatePattern = typeof valueToFill === 'string' && valueToFill.includes('/') && valueToFill.split('/').length === 3;

        if (isDateKey || isDatePattern) {
            console.log(`[DEBUG FECHA] Procesando campo de fecha: ${dataKey}`);
            console.log(`[DEBUG FECHA] Tipo de elemento en web: ${element.type}`);
            console.log(`[DEBUG FECHA] Valor original: ${valueToFill}`);

            // Si el input en la web es de tipo nativo "date", requiere YYYY-MM-DD
            if (element.type === 'date' || element.getAttribute('type') === 'date') {
                const formatted = formatBirthDate(valueToFill, 'iso');
                console.log(`[DEBUG FECHA] Transformado a ISO para input nativo: ${formatted}`);
                valueToFill = formatted;
            } else {
                // Si es un input de texto normal, nos aseguramos de que esté en formato DD/MM/YYYY limpio
                const formatted = formatBirthDate(valueToFill, 'eu');
                console.log(`[DEBUG FECHA] Formateado a EU para input de texto: ${formatted}`);
                valueToFill = formatted;
            }
        }

        // --- PROCESO DE RELLENADO SEGÚN TIPO DE SELECTOR ---

        // CASO 1: Selector de tipo Objeto con mapeo de opciones (para SELECT nativos)
        if (typeof selectorData === 'object' && selectorData.type === 'select' && selectorData.options) {
            const optionsMap = selectorData.options;
            const targetValue = optionsMap[valueToFill.toString().trim().toLowerCase()];
            
            if (targetValue !== undefined) {
                element.value = targetValue;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                if (keyFields.includes(dataKey)) report.fields_found++;
                console.log(`%c[${dataKey}] Select rellenado: ${targetValue}`, "color: green;");
            } else {
                console.warn(`[${dataKey}] Valor "${valueToFill}" no encontrado en el mapa de opciones.`);
            }
        } 
        // CASO 2: Selector de tipo DIV o componente personalizado que solo requiere Clic
        else if (typeof selectorData === 'object' && selectorData.type === 'div') {
            console.log(`[${dataKey}] Haciendo clic en componente.`);
            element.click();
            if (keyFields.includes(dataKey)) report.fields_found++;
        } 
        // CASO 3: INPUTS estándar, fechas y áreas de texto
        else {
            try {
                // Simular interacción humana inicial
                element.focus();
                element.click();

                // ASIGNACIÓN DEL VALOR (Crucial: aquí valueToFill ya está formateado si era fecha)
                console.log(`[DEBUG FILL] Asignando valor "${valueToFill}" al campo ${dataKey}`);
                element.value = valueToFill;

                // DISPARAR EVENTOS: Esto es vital para que frameworks como React/Angular detecten el cambio
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Salir del campo para disparar validaciones de la web
                element.blur();

                if (keyFields.includes(dataKey)) report.fields_found++;
                console.log(`%c[${dataKey}] Rellenado con éxito: ${valueToFill}`, "color: green; font-weight: bold;");

            } catch (error) {
                console.error(`Error crítico rellenando ${dataKey}:`, error);
            }
        }
    }

    console.log("------------------- FIN DEL PROCESO -------------------");
    return report;
}

// ============================================================================
// Manual Field Mapping System - Phase 1
// ============================================================================
// Las variables de mapeo ya están declaradas al inicio del archivo

/**
 * Generate a hierarchical CSS selector for an element.
 * Prefers ID attributes, then data attributes, then class names.
 */
function generateHierarchicalSelector(element) {
    if (!element || element === document.body) return 'body';

    const path = [];
    let current = element;

    while (current && current !== document.body && current !== document.documentElement) {
        let selector = current.tagName.toLowerCase();

        // 1. ANCLA DEFINITIVA: ID (Si no es dinámico)
        if (current.id && !/^(ng-|ember|__)/.test(current.id) && !/\d{4,}/.test(current.id)) {
            selector += `#${current.id}`;
            path.unshift(selector);
            break; // Si encontramos un ID sólido, paramos de subir
        }

        // 2. ATRIBUTOS DE DATOS (Estándar en apps modernas: React, Vue, Angular)
        // Buscamos atributos que los desarrolladores usan para testear o referenciar
        const stableAttr = ['data-testid', 'data-qa', 'data-ref', 'data-cy', 'name', 'aria-label'].find(attr => current.getAttribute(attr));
        if (stableAttr) {
            selector += `[${stableAttr}="${current.getAttribute(stableAttr)}"]`;
        } 
        
        // 3. FILTRADO DE CLASES (Evitar "clases basura")
        else if (current.className && typeof current.className === 'string') {
            const cleanClasses = current.className.trim().split(/\s+/)
                .filter(c => {
                    return c && 
                        !/^(ng-|star-|jss|css-|v-)/.test(c) && // Evitar prefijos de frameworks
                        !/\d{5,}/.test(c) && // Evitar hashes largos (clases dinámicas)
                        !['flex', 'row', 'col', 'active', 'selected'].includes(c.toLowerCase()); // Evitar utilidades visuales
                });

            if (cleanClasses.length > 0) {
                // Usamos la primera clase que parezca descriptiva
                selector += `.${cleanClasses[0]}`;
            }
        }

        // 4. PRECISIÓN POR POSICIÓN (Para elementos repetidos)
        // Solo añadimos el índice si el elemento tiene hermanos del mismo tipo
        // Esto es lo que diferencia Origen de Destino en cualquier web
        let index = 1;
        let hasSiblings = false;
        let prev = current.previousElementSibling;
        while (prev) {
            if (prev.tagName === current.tagName) index++;
            prev = prev.previousElementSibling;
        }
        let next = current.nextElementSibling;
        while (next) {
            if (next.tagName === current.tagName) {
                hasSiblings = true;
                break;
            }
            next = next.nextElementSibling;
        }

        if (index > 1 || hasSiblings) {
            selector += `:nth-of-type(${index})`;
        }

        path.unshift(selector);
        current = current.parentElement;
    }

    // --- EL CAMBIO MAESTRO: ESPACIO EN LUGAR DE '>' ---
    // Esto hace que el selector sea: "#id .bloque .dato"
    // En lugar de: "#id > div > div > .dato"
    // Es infinitamente más resistente a cambios de diseño.
    return path.join(' ');
}

/**
 * Check if a class name is generic (too common to be useful)
 */
function isGenericClass(className) {
    const genericClasses = ['container', 'wrapper', 'content', 'main', 'section', 'div', 'span', 'box', 'item'];
    return genericClasses.includes(className.toLowerCase());
}

/**
 * Extract value from an element based on its type
 */
function extractElementValue(element, selector) {
    if (!element) return null;
    
    const tagName = element.tagName.toLowerCase();
    
    // Input elements
    if (tagName === 'input' || tagName === 'textarea') {
        return element.value || '';
    }
    
    // Select elements
    if (tagName === 'select') {
        return element.value || (element.selectedOptions[0]?.text || '');
    }
    
    // Text elements
    if (['span', 'div', 'p', 'td', 'th', 'label'].includes(tagName)) {
        return element.textContent?.trim() || element.innerText?.trim() || '';
    }
    
    // Data attributes
    if (element.dataset.value) {
        return element.dataset.value;
    }
    
    // Fallback to textContent
    return element.textContent?.trim() || '';
}

/**
 * Enter quick selection mode (without field specified yet)
 */
function enterQuickSelectionMode() {
    setMappingMode(true);
    setCurrentMappingField(null); // Will be set after element selection
    setCurrentMappingType(null);
    
    // Create overlay (non-interactive, just visual)
    const overlay = document.createElement('div');
    setMappingOverlay(overlay);
    mappingOverlay = overlay;
    mappingOverlay.id = 'capdata-mapping-overlay';
    mappingOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.1);
        z-index: 999998;
        cursor: crosshair !important;
        pointer-events: none;
    `;
    document.body.appendChild(mappingOverlay);
    
    // Add instruction tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'capdata-mapping-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #0672ff;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: none;
    `;
    tooltip.textContent = '🔍 Selection Mode: Click on an element to map it. Press ESC to cancel.';
    document.body.appendChild(tooltip);
    
    // Add hover effect
    document.addEventListener('mouseover', handleElementHover, true);
    document.addEventListener('click', handleQuickElementClick, true);
    
    // Change cursor on entire document
    document.documentElement.style.cursor = 'crosshair';
    document.body.style.cursor = 'crosshair';
    
    // Prevent text selection
    document.body.style.userSelect = 'none';
    
    // Notify background script
    chrome.runtime.sendMessage({
        action: 'mappingModeStarted'
    });
}

/**
 * Activa el modo de selección visual en la página actual.
 * @param {string} fieldName - Nombre técnico del campo.
 * @param {string} fieldType - Tipo de mapeo (capture/autofill).
 * @param {string|null} domain - Dominio actual.
 * @param {string|null} label - Etiqueta amigable (ej: "Price").
 * @param {string|null} description - Descripción detallada del campo.
 * @param {string|null} serviceType - Tipo de servicio (ej: "aereo", "hotel").
 */
function enterSelectionMode(fieldName, fieldType, domain = null, label = null, description = null, serviceType = null) {
    // --- SEGURIDAD: Limpiar cualquier estado previo antes de iniciar ---
    // Esto evita que las capas oscuras se acumulen y limpia eventos antiguos.
    exitSelectionMode();

    console.log('CONTENT: enterSelectionMode called with:', { fieldName, fieldType, domain, label });
    
    // Actualizar estado global y variables de window
    setMappingMode(true);
    setCurrentMappingField(fieldName);
    setCurrentMappingType(fieldType);
    setCurrentMappingDomain(domain || window.location.hostname);
    window.capdataMappingVars.currentServiceType = serviceType;
    // 1. Crear el overlay (capa visual sutil para indicar modo selección)
    const overlay = document.createElement('div');
    overlay.id = 'capdata-mapping-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.05);
        z-index: 999998;
        cursor: crosshair !important;
        pointer-events: none;
    `;
    document.body.appendChild(overlay);
    setMappingOverlay(overlay);
    mappingOverlay = overlay;
    
    // 2. Crear el tooltip de instrucciones mejorado con descripción
    const tooltip = document.createElement('div');
    tooltip.id = 'capdata-mapping-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        top: 25px;
        left: 50%;
        transform: translateX(-50%);
        background: #0672ff;
        color: white;
        padding: 16px 22px;
        border-radius: 12px;
        z-index: 999999;
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        pointer-events: none;
        max-width: 400px;
        text-align: center;
        line-height: 1.5;
        border: 1px solid rgba(255,255,255,0.2);
    `;
    
    // Usar los textos amigables pasados desde mapping.js
    const displayLabel = label || fieldName;
    const displayDesc = description || "Click on the element that contains this data to map it.";

    tooltip.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 10px;">
            <span style="font-size: 20px;">🔍</span> Mapping: ${displayLabel}
        </div>
        <div style="font-size: 13px; opacity: 0.9; font-weight: normal; border-top: 1px solid rgba(255,255,255,0.3); margin-top: 8px; padding-top: 8px;">
            ${displayDesc}
        </div>
        <div style="font-size: 11px; margin-top: 12px; color: #ffeb3b; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
            Press <span style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.3);">ESC</span> to cancel
        </div>
    `;
    
    document.body.appendChild(tooltip);
    
    // 3. Agregar los listeners de eventos (Fase de captura para prioridad)
    document.addEventListener('mouseover', handleElementHover, true);
    document.addEventListener('click', handleElementClick, true);
    
    // 4. Cambiar el cursor y comportamiento visual del documento
    document.documentElement.style.cursor = 'crosshair';
    document.body.style.cursor = 'crosshair';
    
    // 5. Deshabilitar la selección de texto para que el usuario no se distraiga al hacer clic
    document.body.style.userSelect = 'none';
    
    // 6. Notificar al background script que el proceso visual ha comenzado
    chrome.runtime.sendMessage({
        action: 'mappingModeStarted',
        fieldName: fieldName,
        fieldType: fieldType
    });

    console.log("CONTENT: enterSelectionMode finalizado con éxito para:", fieldName);
}

/**
 * Handle quick element click (when field is not specified yet)
 */
function handleQuickElementClick(e) {
    if (!isMappingMode) return;
    
    // Skip overlay and tooltip
    if (e.target === mappingOverlay || e.target.id === 'capdata-mapping-tooltip') {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const element = e.target;
    if (!element) return;
    
    // Generate selector
    const selector = generateHierarchicalSelector(element);
    const value = extractElementValue(element, selector);
    
    // Determine selector type and extraction method
    const tagName = element.tagName.toLowerCase();
    let selectorType = 'css';
    let extractionMethod = 'textContent';
    
    // Si el selector es jerárquico (contiene ">"), usar 'hierarchical' (como en mapping.js)
    // Si es un selector simple, podemos usar el tipo específico
    if (selector.includes(' > ')) {
        selectorType = 'hierarchical'; // Selector jerárquico usa 'hierarchical' (como en mapping.js)
    } else if (tagName === 'input' || tagName === 'textarea') {
        selectorType = 'input';
        extractionMethod = 'value';
    } else if (tagName === 'select') {
        selectorType = 'select';
        extractionMethod = 'value';
    } else {
        // Para elementos de texto simples, usar 'css' también
        selectorType = 'css';
        extractionMethod = 'textContent';
    }
    
    // Exit selection mode
    exitSelectionMode();
    
    // Open mapping UI and pass the selected element info
    chrome.runtime.sendMessage({
        action: 'openMappingUIWithElement',
        domain: window.location.hostname,
        selector: selector,
        selectorType: selectorType,
        extractionMethod: extractionMethod,
        previewValue: value
    });
}

/**
 * Exit selection mode
 */
function exitSelectionMode() {
    // 1. Resetear el estado en el objeto global y variables locales
    setMappingMode(false);
    setCurrentMappingField(null);
    setCurrentMappingType(null);
    setCurrentMappingDomain(null);
    
    // 2. Eliminar TODOS los overlays por ID para evitar acumulación de capas (Pantalla oscura)
    const overlays = document.querySelectorAll('#capdata-mapping-overlay');
    overlays.forEach(el => el.remove());
    setMappingOverlay(null);
    
    // 3. Eliminar TODOS los tooltips por ID
    const tooltips = document.querySelectorAll('#capdata-mapping-tooltip');
    tooltips.forEach(el => el.remove());
    
    // 4. Eliminar los event listeners (usando la fase de captura 'true' como se agregaron)
    document.removeEventListener('mouseover', handleElementHover, true);
    document.removeEventListener('click', handleElementClick, true);
    document.removeEventListener('click', handleQuickElementClick, true);
    
    // 5. Eliminar el resaltado visual del último elemento seleccionado
    if (highlightedElement) {
        highlightedElement.style.outline = '';
        highlightedElement.style.outlineOffset = '';
        highlightedElement.style.transition = '';
        setHighlightedElement(null);
    }

    // 6. Limpieza de seguridad: Buscar cualquier otro elemento que se haya quedado con el contorno verde
    // (Útil si el usuario movió el ratón muy rápido)
    const residualHighlights = document.querySelectorAll('[style*="outline: 3px solid rgb(76, 175, 80)"]');
    residualHighlights.forEach(el => {
        el.style.outline = '';
        el.style.outlineOffset = '';
    });
    
    // 7. Restaurar el cursor y la selección de texto del navegador
    document.documentElement.style.cursor = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    console.log("BACKGROUND: Modo selección finalizado y UI limpiada.");
}

/**
 * Handle element hover for highlighting
 */
function handleElementHover(e) {
    if (!isMappingMode) return;
    
    // Skip overlay and tooltip
    if (e.target === mappingOverlay || e.target.id === 'capdata-mapping-tooltip') {
        return;
    }
    
    // Remove previous highlight
    if (highlightedElement && highlightedElement !== e.target) {
        highlightedElement.style.outline = '';
        highlightedElement.style.outlineOffset = '';
    }
    
    // Highlight current element
    setHighlightedElement(e.target);
    if (highlightedElement) {
        highlightedElement.style.outline = '3px solid #4CAF50';
        highlightedElement.style.outlineOffset = '2px';
        highlightedElement.style.transition = 'outline 0.1s ease';
    }
}

/**
 * Handle element click for mapping
 */
function handleElementClick(e) {
    if (!isMappingMode) {
        console.log('CONTENT: handleElementClick called but not in mapping mode');
        return;
    }
    
    // Skip overlay and tooltip
    if (e.target === mappingOverlay || e.target.id === 'capdata-mapping-tooltip') {
        console.log('CONTENT: Clicked on overlay or tooltip, ignoring');
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const element = e.target;
    if (!element) {
        console.log('CONTENT: No element found');
        return;
    }
    
    console.log('CONTENT: Element clicked for mapping:', element, 'Field:', currentMappingField);
    
    // Generate selector
    const selector = generateHierarchicalSelector(element);
    const value = extractElementValue(element, selector);
    
    console.log('CONTENT: Generated selector:', selector, 'Value:', value);
    
    // Determine selector type and extraction method
    const tagName = element.tagName.toLowerCase();
    let selectorType = 'css';
    let extractionMethod = 'textContent';
    
    // Si el selector es jerárquico (contiene ">"), usar 'hierarchical' (como en mapping.js)
    // Si es un selector simple, podemos usar el tipo específico
    if (selector.includes(' > ')) {
        selectorType = 'hierarchical'; // Selector jerárquico usa 'hierarchical' (como en mapping.js)
    } else if (tagName === 'input' || tagName === 'textarea') {
        selectorType = 'input';
        extractionMethod = 'value';
    } else if (tagName === 'select') {
        selectorType = 'select';
        extractionMethod = 'value';
    } else {
        // Para elementos de texto simples, usar 'css' también
        selectorType = 'css';
        extractionMethod = 'textContent';
    }
    
    // Save field info before exiting selection mode (which clears them)
    const savedFieldName = currentMappingField;
    const savedFieldType = currentMappingType;
    const savedServiceType = window.capdataMappingVars.currentServiceType;
    // Exit selection mode
    exitSelectionMode();
    
    // Create floating popup at click position
    const domainToUse = currentMappingDomain || window.location.hostname;
    console.log('CONTENT: Showing floating popup with domain:', domainToUse);
    showFloatingMappingPopup({
        fieldName: savedFieldName,
        fieldType: savedFieldType,
        serviceType: savedServiceType,
        selector: selector,
        selectorType: selectorType,
        extractionMethod: extractionMethod,
        previewValue: value,
        domain: domainToUse,
        element: element
    });
}

// Floating popup for mapping confirmation
// Las variables floatingPopup y floatingPopupMinimized ya están declaradas al inicio del archivo

function showFloatingMappingPopup(mappingData) {
    // Remove existing popup if any
    if (floatingPopup) {
        floatingPopup.remove();
    }
    
    // Calcular posición centrada en la pantalla visible
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popupWidth = Math.min(600, viewportWidth - 40); // 40px de margen
    const popupHeight = 500; // Altura estimada
    const topPosition = Math.max(20, (viewportHeight - popupHeight) / 2);
    const leftPosition = (viewportWidth - popupWidth) / 2;
    
    // Create popup
    const popup = document.createElement('div');
    setFloatingPopup(popup);
    floatingPopup = popup;
    floatingPopup.id = 'capdata-floating-mapping-popup';
    floatingPopup.style.cssText = `
        position: fixed;
        top: ${topPosition}px;
        left: ${leftPosition}px;
        background: white;
        border: 2px solid #0672ff;
        border-radius: 8px;
        padding: 15px;
        z-index: 2147483647;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        min-width: 400px;
        width: ${popupWidth}px;
        max-width: 600px;
        max-height: ${viewportHeight - 40}px;
        overflow-y: auto;
        font-family: Arial, sans-serif;
    `;
    
    const fieldLabel = getFieldLabelForPopup(mappingData.fieldName);
    
    floatingPopup.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; color: #0672ff; font-size: 16px;">Confirmar Mapeo</h3>
            <div style="display: flex; gap: 5px;">
                <button id="minimizeFloatingPopup" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #999; padding: 0; width: 24px; height: 24px;">−</button>
                <button id="closeFloatingPopup" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #999; padding: 0; width: 24px; height: 24px;">&times;</button>
            </div>
        </div>
        <div style="margin-bottom: 10px; font-size: 12px;">
            <strong>Campo:</strong> ${fieldLabel} (${mappingData.fieldName})<br>
            <strong>Tipo:</strong> ${mappingData.fieldType === 'capture' ? 'Capture (Leer)' : 'Autofill (Escribir)'}<br>
            <strong>Dominio:</strong> ${mappingData.domain}
        </div>
        <div style="margin-bottom: 10px;">
            <label style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 12px;">Selector:</label>
            <code id="floatingSelector" contenteditable="true" style="display: block; background: #f5f5f5; padding: 8px; border-radius: 4px; word-break: break-all; font-size: 11px; font-family: monospace; border: 1px solid #ddd; min-height: 40px;">${mappingData.selector}</code>
        </div>
        <div style="margin-bottom: 10px;">
            <label style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 12px;">Método de Extracción:</label>
            <select id="floatingExtractionMethod" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
                <option value="textContent" ${mappingData.extractionMethod === 'textContent' ? 'selected' : ''}>textContent</option>
                <option value="value" ${mappingData.extractionMethod === 'value' ? 'selected' : ''}>value (para inputs/selects)</option>
                <option value="innerText" ${mappingData.extractionMethod === 'innerText' ? 'selected' : ''}>innerText</option>
            </select>
        </div>
        <div style="margin-bottom: 10px; font-size: 12px;">
            <strong>Valor de Ejemplo:</strong>
            <code style="display: block; background: #e6ffe6; padding: 6px; border-radius: 4px; margin-top: 5px; font-size: 11px; font-family: monospace; word-break: break-all;">${mappingData.previewValue || '(sin valor)'}</code>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button id="confirmFloatingMapping" style="flex: 1; background-color: #28a745; border-color: #28a745; color: white; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">✓ Confirmar y Guardar</button>
            <button id="cancelFloatingMapping" style="flex: 1; background-color: #dc3545; border-color: #dc3545; color: white; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">✗ Cancelar</button>
        </div>
    `;
    
    document.body.appendChild(floatingPopup);
    
    // Store mapping data
    floatingPopup.mappingData = mappingData;
    
    // Event listeners
    document.getElementById('minimizeFloatingPopup').addEventListener('click', () => {
        minimizeFloatingPopup();
    });
    
    document.getElementById('closeFloatingPopup').addEventListener('click', () => {
        closeFloatingPopup();
    });
    
    document.getElementById('confirmFloatingMapping').addEventListener('click', () => {
        confirmFloatingMapping();
    });
    
    document.getElementById('cancelFloatingMapping').addEventListener('click', () => {
        closeFloatingPopup();
    });
}

function minimizeFloatingPopup() {
    if (!floatingPopup) return;
    
    floatingPopupMinimized = true;
    floatingPopup.style.display = 'none';
    
    // Create restore button
    const restoreBtn = document.createElement('button');
    restoreBtn.id = 'capdata-restore-floating-popup';
    restoreBtn.innerHTML = '📋';
    restoreBtn.title = 'Restaurar diálogo de mapeo';
    restoreBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483646;
        background-color: #0672ff;
        color: white;
        border: none;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        font-size: 20px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
    `;
    
    restoreBtn.addEventListener('click', () => {
        restoreFloatingPopup();
    });
    
    document.body.appendChild(restoreBtn);
}

function restoreFloatingPopup() {
    if (!floatingPopup) return;
    
    floatingPopupMinimized = false;
    floatingPopup.style.display = 'block';
    
    const restoreBtn = document.getElementById('capdata-restore-floating-popup');
    if (restoreBtn) {
        restoreBtn.remove();
    }
}

function closeFloatingPopup() {
    if (floatingPopup) {
        floatingPopup.remove();
        setFloatingPopup(null);
    }
    
    const restoreBtn = document.getElementById('capdata-restore-floating-popup');
    if (restoreBtn) {
        restoreBtn.remove();
    }
    
    floatingPopupMinimized = false;
}

async function confirmFloatingMapping() {
    if (!floatingPopup || !floatingPopup.mappingData) return;
    
    const mappingData = floatingPopup.mappingData;
    const selector = document.getElementById('floatingSelector').textContent.trim();
    const extractionMethod = document.getElementById('floatingExtractionMethod').value;
    
    // Get API key
    const apiKey = await new Promise((resolve) => {
        chrome.storage.local.get(['userApiKey'], (result) => {
            resolve(result.userApiKey || '');
        });
    });
    
    if (!apiKey) {
        alert('Por favor ingresa tu API Key en el popup principal');
        return;
    }
    
    // Validar que todos los campos requeridos estén presentes
    if (!mappingData.domain || !mappingData.fieldName || !selector) {
        alert('Error: Faltan datos requeridos para guardar el mapeo. Por favor, intenta seleccionar el elemento nuevamente.');
        return;
    }
    
    // Asegurarse de que selector_type sea válido
    // Si el selector es jerárquico, usar 'hierarchical' (como en mapping.js)
    // El backend espera 'hierarchical' para selectores jerárquicos
    let selectorType = mappingData.selectorType || 'css';
    if (selector.includes(' > ')) {
        selectorType = 'hierarchical'; // Selector jerárquico usa 'hierarchical' (como en mapping.js)
    } else if (!selectorType || selectorType === 'text') {
        selectorType = 'css'; // Por defecto usar 'css' en lugar de 'text'
    }
    
    const payload = {
        domain: mappingData.domain,
        field_name: mappingData.fieldName,
        field_type: mappingData.fieldType || 'capture',
        service_type: mappingData.serviceType,
        selector_path: selector,
        selector_type: selectorType,
        extraction_method: extractionMethod
    };
    
    console.log('CONTENT: Guardando mapeo con payload:', payload);
    
    try {
        // Mostrar indicador de carga
        const confirmBtn = document.getElementById('confirmFloatingMapping');
        const originalText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Guardando...';
        
        const data = await chrome.runtime.sendMessage({
            action: 'saveFieldSelector',
            apiKey: apiKey,
            payload: payload
        });
        
        // Verificar si hay error de runtime
        if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message);
        }
        
        // Verificar que data existe
        if (!data) {
            throw new Error('No se recibió respuesta del servidor');
        }
        
        // Restaurar botón
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
        
        if (data.status === 'success') {
            closeFloatingPopup();
            // Mostrar notificación de éxito
            showTemporaryNotification('✓ Mapeo guardado correctamente', 'success');
            // Notify mapping window
            chrome.runtime.sendMessage({ action: 'mappingCompleted' }).catch(() => {
                // Ignorar si no hay listeners
            });
        } else {
            // Extraer mensaje de error de forma más robusta
            let errorMessage = 'Error desconocido al guardar el mapeo';
            
            if (data.message) {
                errorMessage = data.message;
            } else if (data.error) {
                errorMessage = data.error;
            } else if (typeof data === 'string') {
                errorMessage = data;
            } else if (data.status === 'error' && data.details) {
                errorMessage = data.details.message || data.details.error || errorMessage;
            }
            
            // Asegurarse de que el mensaje no sea undefined o vacío
            if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '') {
                errorMessage = 'Error desconocido al guardar el mapeo. Por favor, intenta de nuevo.';
            }
            
            console.error('CONTENT: Error guardando mapeo. Respuesta completa:', data);
            console.error('CONTENT: Payload enviado:', payload);
            
            // Mostrar el error en un formato más legible
            // Si el mensaje tiene saltos de línea, usar confirm en lugar de alert para mejor legibilidad
            if (errorMessage.includes('\n')) {
                alert(errorMessage);
            } else {
                alert(`Error: ${errorMessage}`);
            }
        }
    } catch (error) {
        console.error('Error saving mapping:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Restaurar botón en caso de error
        const confirmBtn = document.getElementById('confirmFloatingMapping');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✓ Confirmar y Guardar';
        }
        
        // Mostrar mensaje de error más descriptivo
        let errorMessage = 'Error de red al guardar el mapeo';
        
        if (error && error.message) {
            const msg = error.message.toString();
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                errorMessage = 'Error de conexión: No se pudo conectar con el servidor. Verifica tu conexión a internet.';
            } else if (msg.includes('Could not establish connection')) {
                errorMessage = 'Error: No se pudo conectar con el servicio de la extensión. Intenta recargar la página.';
            } else if (msg.includes('Internal server error') || msg.includes('500')) {
                errorMessage = 'Error del servidor: El servidor encontró un error interno. Por favor, intenta de nuevo más tarde o contacta al soporte.';
            } else if (msg && msg !== 'undefined' && msg.trim() !== '') {
                errorMessage = `Error: ${msg}`;
            }
        } else if (error && error.toString) {
            const errorStr = error.toString();
            if (errorStr && errorStr !== 'undefined' && errorStr.trim() !== '') {
                errorMessage = `Error: ${errorStr}`;
            }
        }
        
        // Asegurarse de que el mensaje no sea undefined
        if (!errorMessage || errorMessage === 'undefined' || errorMessage.trim() === '') {
            errorMessage = 'Error desconocido al guardar el mapeo. Por favor, intenta de nuevo.';
        }
        
        alert(errorMessage);
    }
}

function getFieldLabelForPopup(fieldName) {
    const labels = {
        "localizador": "Localizador Alternativo",
        "codigo_reserva": "Código de Reserva",
        "estado_booking": "Estado",
        "fecha_booking": "Fecha de Reserva",
        "precio": "Precio",
        "divisa": "Divisa"
    };
    return labels[fieldName] || fieldName;
}

function showTemporaryNotification(message, type = 'info') {
    // Remover notificación existente si hay
    const existing = document.getElementById('capdata-temp-notification');
    if (existing) {
        existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.id = 'capdata-temp-notification';
    const bgColor = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#0672ff';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 1000000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;
    
    // Agregar animación CSS si no existe
    if (!document.getElementById('capdata-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'capdata-notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

/**
 * Keyboard shortcut listener (Ctrl+Shift+.)
 */
document.addEventListener('keydown', (e) => {
    // Obtenemos el estado actual directamente del objeto global para máxima fiabilidad
    const isCurrentlyMapping = window.capdataMappingVars ? window.capdataMappingVars.isMappingMode : isMappingMode;

    // 1) Atajo: Ctrl + Shift + . (Punto)
    if (e.ctrlKey && e.shiftKey && (e.key === '.' || e.keyCode === 190)) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log("CAPDATA: Atajo Ctrl+Shift+. detectado. Estado mapping:", isCurrentlyMapping);

        // Si ya está en modo mapeo, lo desactivamos (Toggle)
        if (isCurrentlyMapping) {
            exitSelectionMode();
            // Si el popup flotante de confirmación está abierto, también lo cerramos
            if (typeof closeFloatingPopup === 'function') closeFloatingPopup();
            return;
        }
        
        // Si no está en modo mapeo, abrimos la ventana de configuración de mapeos
        chrome.runtime.sendMessage({ action: 'openMappingWindow' });
    }
    
    // 2) Tecla Escape: Para salir del modo selección o cerrar diálogos
    if (e.key === 'Escape') {
        // Si estamos en modo selección (pantalla con overlay y cursor crosshair)
        if (isCurrentlyMapping) {
            console.log("CAPDATA: Tecla Escape detectada en modo Mapping. Limpiando UI...");
            
            e.preventDefault();
            e.stopPropagation();
            
            // Limpiamos capas oscuras, tooltips y eventos
            exitSelectionMode();
            
            // Notificamos al background para que sepa que el usuario canceló
            chrome.runtime.sendMessage({
                action: 'mappingModeCancelled'
            });
        }
        
        // ADICIONAL: Si el diálogo flotante de confirmación de mapeo está visible, lo cerramos
        const floatingPopup = document.getElementById('capdata-floating-mapping-popup');
        if (floatingPopup) {
            console.log("CAPDATA: Tecla Escape detectada. Cerrando popup flotante.");
            if (typeof closeFloatingPopup === 'function') {
                closeFloatingPopup();
            } else {
                floatingPopup.remove();
            }
        }
    }
}, true); 

} // End of guard block to prevent multiple injections




