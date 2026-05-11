
// Guard to prevent multiple injections
if (window.capdataContentScriptLoaded) {
    console.log('CapData content script already loaded, skipping re-injection');
} else {
    window.capdataContentScriptLoaded = true;

const IFRAME_ID = 'capdata-reserva-iframe';
const RESIZE_HANDLE_ID = 'capdata-resize-handle';
const DRAG_HANDLE_ID = 'capdata-drag-handle';
let iframe = null;
let resizeHandle = null;
let dragHandle = null;
let isResizing = false;
let isDragging = false;
let startX, startY, startWidth, startHeight;
let dragStartX, dragStartY, dragStartTop, dragStartLeft;
let uiEventHandlersBound = false;

function clampContainerPosition(container) {
    if (!container) return;
    const margin = 10;
    const rect = container.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const currentLeft = parseFloat(container.style.left || `${rect.left}`) || margin;
    const currentTop = parseFloat(container.style.top || `${rect.top}`) || margin;
    const clampedLeft = Math.min(Math.max(currentLeft, margin), maxLeft);
    const clampedTop = Math.min(Math.max(currentTop, margin), maxTop);
    container.style.left = `${clampedLeft}px`;
    container.style.top = `${clampedTop}px`;
}

function handleViewportResize() {
    const currentContainer = document.getElementById('capdata-reserva-container');
    clampContainerPosition(currentContainer);
}

function forceStopPointerInteractions() {
    isDragging = false;
    isResizing = false;
}

function bindUIEventHandlers() {
    if (uiEventHandlersBound) return;
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('mouseup', stopDrag);
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('blur', forceStopPointerInteractions);
    uiEventHandlersBound = true;
}

function createUI() {
    if (document.getElementById(IFRAME_ID)) {
        return; 
    }

    // Crear contenedor para el iframe y el handle de redimensionamiento
    const container = document.createElement('div');
    container.id = 'capdata-reserva-container';
    container.style.position = 'fixed';
    container.style.top = '10px';
    container.style.width = '700px';
    container.style.height = '800px';
    container.style.left = `${Math.max(10, window.innerWidth - 710)}px`;
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

    // Barra de arrastre para mover el panel por la página.
    dragHandle = document.createElement('div');
    dragHandle.id = DRAG_HANDLE_ID;
    dragHandle.style.height = '30px';
    dragHandle.style.display = 'flex';
    dragHandle.style.alignItems = 'center';
    dragHandle.style.justifyContent = 'space-between';
    dragHandle.style.padding = '0 10px';
    dragHandle.style.background = 'linear-gradient(180deg, #f8f9fa, #eef2f7)';
    dragHandle.style.borderBottom = '1px solid #d8dee8';
    dragHandle.style.cursor = 'move';
    dragHandle.style.userSelect = 'none';
    dragHandle.style.fontFamily = 'Arial, sans-serif';
    dragHandle.style.fontSize = '12px';
    dragHandle.style.color = '#555';
    dragHandle.title = 'Arrastra para mover';

    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.textContent = 'i';
    infoBtn.title = 'Webs validadas';
    infoBtn.style.cssText = 'width:18px;height:18px;border-radius:50%;border:1px solid #22a06b;background:#e8f7ef;color:#167a4d;font-weight:700;font-size:12px;line-height:16px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;';

    const dragLabel = document.createElement('span');
    dragLabel.textContent = 'Arrastrar';
    dragLabel.style.cssText = 'font-weight:600;opacity:.8;flex:1;text-align:center;padding:0 8px;';

    const closeHandleBtn = document.createElement('button');
    closeHandleBtn.type = 'button';
    closeHandleBtn.textContent = '×';
    closeHandleBtn.title = 'Cerrar';
    closeHandleBtn.style.cssText = 'border:none;background:transparent;color:#666;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;flex:0 0 auto;border-radius:4px;transition:background-color .15s ease,color .15s ease;';

    dragHandle.appendChild(infoBtn);
    dragHandle.appendChild(dragLabel);
    dragHandle.appendChild(closeHandleBtn);

    const stopHandleButtonEvent = (event) => {
        event.stopPropagation();
    };
    infoBtn.addEventListener('mousedown', stopHandleButtonEvent);
    closeHandleBtn.addEventListener('mousedown', stopHandleButtonEvent);

    closeHandleBtn.addEventListener('mouseenter', () => {
        closeHandleBtn.style.color = '#222';
        closeHandleBtn.style.backgroundColor = '#e9ecef';
    });
    closeHandleBtn.addEventListener('mouseleave', () => {
        closeHandleBtn.style.color = '#666';
        closeHandleBtn.style.backgroundColor = 'transparent';
    });

    infoBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const existingPopup = document.getElementById('capdata-supported-domains-popup');
        if (existingPopup) {
            existingPopup.remove();
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'capdata-supported-domains-popup';
        popup.style.cssText = 'position:absolute;top:34px;left:10px;right:10px;background:#e8f7ef;color:#167a4d;border:1px solid #b6e5ca;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.35;box-shadow:0 2px 8px rgba(0,0,0,0.1);z-index:1000001;';

        const popupHeader = document.createElement('div');
        popupHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px;';

        const popupTitle = document.createElement('strong');
        popupTitle.textContent = 'Webs validadas';
        popupTitle.style.cssText = 'font-size:12px;';

        const popupCloseBtn = document.createElement('button');
        popupCloseBtn.type = 'button';
        popupCloseBtn.textContent = '×';
        popupCloseBtn.title = 'Cerrar aviso';
        popupCloseBtn.style.cssText = 'border:none;background:transparent;color:#167a4d;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;';
        popupCloseBtn.addEventListener('mousedown', stopHandleButtonEvent);
        popupCloseBtn.addEventListener('click', (closeEvent) => {
            closeEvent.stopPropagation();
            popup.remove();
        });

        const popupBody = document.createElement('div');
        popupBody.textContent = 'Webs validadas actualmente: Ryanair y Vueling.';

        popupHeader.appendChild(popupTitle);
        popupHeader.appendChild(popupCloseBtn);
        popup.appendChild(popupHeader);
        popup.appendChild(popupBody);
        container.appendChild(popup);
    });

    closeHandleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        destroyUI();
    });

    iframe = document.createElement('iframe');
    iframe.id = IFRAME_ID;
    iframe.src = chrome.runtime.getURL('popup.html');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.flex = '1';
    iframe.style.minHeight = '0';
    iframe.style.overflow = 'auto'; // Permitir scroll si el contenido es más grande

    // Crear handle de redimensionamiento en la esquina inferior derecha.
    resizeHandle = document.createElement('div');
    resizeHandle.id = RESIZE_HANDLE_ID;
    resizeHandle.style.width = '24px';
    resizeHandle.style.height = '24px';
    resizeHandle.style.position = 'absolute';
    resizeHandle.style.bottom = '0';
    resizeHandle.style.right = '0';
    resizeHandle.style.cursor = 'nwse-resize';
    resizeHandle.style.backgroundColor = 'transparent';
    resizeHandle.style.borderBottomRightRadius = '8px';
    resizeHandle.style.zIndex = '1000000';
    
    // Icono visual en la esquina inferior derecha.
    resizeHandle.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" style="position: absolute; bottom: 2px; right: 2px;"><path d="M16 16 L16 0 L0 16 Z" stroke="#666" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="1" fill="#666"/></svg>';
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
    dragHandle.addEventListener('mousedown', startDrag);
    bindUIEventHandlers();

    container.appendChild(dragHandle);
    container.appendChild(iframe);
    container.appendChild(resizeHandle);
    document.body.appendChild(container);
    clampContainerPosition(container);
}

function startResize(e) {
    if (e.button !== 0) return;
    isResizing = true;
    isDragging = false;
    const container = document.getElementById('capdata-reserva-container');
    startX = e.clientX;
    startY = e.clientY;
    startWidth = parseInt(window.getComputedStyle(container).width, 10);
    startHeight = parseInt(window.getComputedStyle(container).height, 10);
    e.preventDefault();
}

function doResize(e) {
    if (!isResizing) return;
    if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        stopResize();
        return;
    }
    
    const container = document.getElementById('capdata-reserva-container');
    if (!container) return;

    // Handle en esquina inferior derecha.
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    const newWidth = startWidth + deltaX;
    const newHeight = startHeight + deltaY; // Sumamos porque arrastramos hacia abajo
    
    // Tamaños mínimos para evitar que se haga demasiado pequeño
    const minWidth = 400;
    const minHeight = 300;
    // Altura máxima: altura de ventana menos márgenes (10px arriba + 10px abajo)
    const maxHeight = window.innerHeight - 20;
    const left = parseInt(container.style.left || '10', 10);
    const maxWidth = Math.max(minWidth, window.innerWidth - left - 10);
    
    container.style.width = Math.max(minWidth, Math.min(newWidth, maxWidth)) + 'px';
    container.style.height = Math.max(minHeight, Math.min(newHeight, maxHeight)) + 'px';
    container.style.maxHeight = `${maxHeight}px`; // Asegurar que respete el máximo
}

function stopResize() {
    isResizing = false;
}

function startDrag(e) {
    if (isResizing || e.button !== 0) return;
    if (e.target && e.target.closest('button')) return;
    const container = document.getElementById('capdata-reserva-container');
    if (!container) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTop = parseFloat(container.style.top || '10');
    dragStartLeft = parseFloat(container.style.left || '10');
    e.preventDefault();
}

function doDrag(e) {
    if (!isDragging || isResizing) return;
    if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        stopDrag();
        return;
    }
    const container = document.getElementById('capdata-reserva-container');
    if (!container) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    container.style.left = `${dragStartLeft + deltaX}px`;
    container.style.top = `${dragStartTop + deltaY}px`;
    clampContainerPosition(container);
}

function stopDrag() {
    isDragging = false;
}

function destroyUI() {
    const container = document.getElementById('capdata-reserva-container');
    if (container) {
        container.remove();
        iframe = null;
        resizeHandle = null;
        dragHandle = null;
        isDragging = false;
        isResizing = false;
    }
}

function toggleUI() {
    const existingContainer = document.getElementById('capdata-reserva-container');
    if (existingContainer) {
        // Si ya existe, lo quitamos
        destroyUI();
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
        destroyUI();
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

} // End of guard block to prevent multiple injections




