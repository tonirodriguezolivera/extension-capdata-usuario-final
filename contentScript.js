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
// ELIMINADO: Todo el sistema de mapeo ha sido removido para la versión de usuario final
// ============================================================================
// ELIMINADO: Todo el sistema de mapeo ha sido removido para la versión de usuario final
// Las funciones generateHierarchicalSelector, extractElementValue, enterQuickSelectionMode,
// enterSelectionMode, exitSelectionMode, handleElementHover, handleElementClick,
// handleQuickElementClick, showFloatingMappingPopup, confirmFloatingMapping,
// getFieldLabelForPopup y el listener de teclado Ctrl+Shift+. han sido eliminados.
// ============================================================================

} // End of guard block to prevent multiple injections




