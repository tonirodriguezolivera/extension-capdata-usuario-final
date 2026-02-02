// popup.js (VERSIÓN FINAL Y LIMPIA CON PESTAÑAS) 

let STANDARD_FIELDS = [];
let AVSIS_SPECIFIC_FIELDS = [];
let GESINTUR_BILETE_FIELDS = [];
let GESINTUR_NORMAL_FIELDS = [];
let PIPELINE_ORBISWEB_FIELDS = [];
let cachedAvsisStatus = false;
let cachedGesinturStatus = false;
let cachedOrbiswebStatus = false;
let selectedReservationType = null;
let selectedOrbiswebType = null;
let allContacts = [];
let filteredContacts = [];
let currentPage = 1;
const CONTACTS_PER_PAGE = 10;
let selectedContact = null;
let currentFolderId = null; // null = Raíz
let currentFolderName = 'Inicio';

function notifySizeChange() {
    // Usamos scrollHeight para obtener la altura total del contenido
    // También consideramos offsetHeight para asegurar que capturamos todo
    const height = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
    );
    chrome.runtime.sendMessage({ action: 'resizeIframe', height: height });
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
        // analyzeAndFillBtn: document.getElementById('analyzeAndFillBtn')

        saveAllBtn: document.getElementById('saveAllBtn'),
        discardBtn: document.getElementById('discardBtn'),
        // Carpetas
        backToRootBtn: document.getElementById('backToRootBtn'),
        folderNavBar: document.getElementById('folderNavBar'),
        currentFolderNameLabel: document.getElementById('currentFolderName'),
        // Pestaña Mapeo
        mappingType: document.getElementById('mappingType'),
        mappingDomain: document.getElementById('mappingDomain'),
        loadMappingsBtn: document.getElementById('loadMappingsBtn'),
        mappingFieldsContainer: document.getElementById('mappingFieldsContainer'),
        mappingConfirmDialog: document.getElementById('mappingConfirmDialog'),
        confirmFieldName: document.getElementById('confirmFieldName'),
        confirmFieldType: document.getElementById('confirmFieldType'),
        confirmSelector: document.getElementById('confirmSelector'),
        confirmValue: document.getElementById('confirmValue'),
        confirmMappingBtn: document.getElementById('confirmMappingBtn'),
        cancelMappingBtn: document.getElementById('cancelMappingBtn'),
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
    
    // Set up global mapping message listener (after ui is defined)
    setupMappingMessageListener(ui);
    
    // --- LISTENERS ---
    // General
    document.getElementById('closeBtn')?.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'closeUI' });
        });
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.savedReservationData) {
            initializePopup(ui);
        }
    });

    if (ui.backToRootBtn) {
        ui.backToRootBtn.addEventListener('click', () => {
            enterFolder(null, 'Inicio', ui);
        });
    }

    ui.saveApiKeyBtn.addEventListener('click', () => saveApiKey(ui));

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
        const fieldsDef = await chrome.runtime.sendMessage({ action: 'getFieldsDefinition' });
        if (!fieldsDef || fieldsDef.status !== 'success') throw new Error(fieldsDef.message || "Respuesta inválida.");
        
        // --- CARGA DE DEFINICIONES DESDE EL BACKEND ---
        STANDARD_FIELDS = fieldsDef.standard_fields;
        // NUEVO: Guardamos el mapa de todos los servicios (aereo, hotel, rent_a_car, tren)
        ALL_SERVICE_FIELDS = fieldsDef.service_fields; 
        
        AVSIS_SPECIFIC_FIELDS = fieldsDef.avsis_fields;
        GESINTUR_BILETE_FIELDS = fieldsDef.gesintur_billete_fields || [];
        GESINTUR_NORMAL_FIELDS = fieldsDef.gesintur_normal_fields || [];
        PIPELINE_ORBISWEB_FIELDS = fieldsDef.pipeline_orbisweb_fields || [];
    } catch (error) {
        showStatus(ui, 'Error: No se pudo cargar la configuración de captura.', 'error');
        showSpinner(ui, false);
        return;
    }

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
            // Si es un tipo de ORBISWEB
            else {
                ui.mainServiceType.value = reservationType; 
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
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            
            // Mostrar selector de tipo ORBISWEB solo si orbisweb está activo
            const orbiswebTypeContainer = document.getElementById('orbiswebTypeContainer');
            if (orbiswebTypeContainer) {
                orbiswebTypeContainer.style.display = 'none';
            }
            
            // Preparar mensajes de estado
            const messages = ['Mostrando última reserva capturada.'];
            const hasActiveIntegrations = avsisResult.active || gesinturResult.active || orbiswebResult.active;
            
            if (avsisResult.message) messages.push(avsisResult.message);
            if (gesinturResult.message) messages.push(gesinturResult.message);
            if (orbiswebResult.message) messages.push(orbiswebResult.message);
            
            showStatus(ui, messages.join(' '), hasActiveIntegrations ? 'success' : 'info');
        } else {
            showStatus(ui, 'Mostrando última reserva capturada.', 'info');
        }

        // DIBUJAR FORMULARIO (Ahora usará ALL_SERVICE_FIELDS internamente)
        buildMultiEditableForm(ui, savedReservationData);
        ui.formContainer.style.display = 'block';
        ui.globalActionsRow.style.display = 'flex';

    } else {
        // --- CASO: NO HAY DATOS GUARDADOS ---
        const { userApiKey } = await chrome.storage.local.get('userApiKey');
        if (userApiKey) {
            const avsisResult = await checkAvsisStatus(userApiKey);
            cachedAvsisStatus = avsisResult.active;
            
            const gesinturResult = await checkGesinturStatus(userApiKey);
            cachedGesinturStatus = gesinturResult.active;
            
            const orbiswebResult = await checkOrbiswebStatus(userApiKey);
            cachedOrbiswebStatus = orbiswebResult.active;
            
            // Actualizar visibilidad de desplegables según integraciones activas
            updateServiceTypeVisibility();
            
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
                ui.statusDiv.style.display = 'none';
            }
        } else {
            showStatus(ui, 'Por favor, guarda tu API Key.', 'info');
        }
    }
    showSpinner(ui, false);
}

async function checkAvsisStatus(apiKey) {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkApsysIntegration', apiKey });
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
            console.log("🔍 Integraciones recibidas:", response.integrations);
            const orbiswebIntegration = response.integrations.find(int => 
                int.slug && (int.slug.toLowerCase() === 'orbisweb' || 
                            int.slug.toLowerCase() === 'orbis_web' || 
                            int.slug.toLowerCase() === 'orbis-web' ||
                            int.slug.toLowerCase().includes('orbis'))
            );
            console.log("🔍 Integración ORBISWEB encontrada:", orbiswebIntegration);
            
            const isActive = orbiswebIntegration ? orbiswebIntegration.active : false;
            const message = isActive ? '✅ Integración Pipeline/ORBISWEB ACTIVA.' : '';
            return { active: isActive, message: message };
        }
        return { active: false, message: `⚠️ ${response.message || 'Respuesta inesperada.'}` };
    } catch (error) {
        return { active: false, message: `🚨 Error de conexión: ${error.message}` };
    }
}

// Función para verificar si un dominio tiene mapeos
async function checkDomainMappings(domain, apiKey, reservationType) {
    const API_BASE_URL = 'https://capdata.es';
    
    try {
        const typeNormal = reservationType;
        const typeOneWay = `${reservationType}_oneway`;

        // Consultar ambos tipos de mapeos en paralelo
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

        let mappingsNormal = {};
        let mappingsOneWay = {};

        if (dataNormal.status === 'success' && dataNormal.mappings) {
            mappingsNormal = dataNormal.mappings;
        }
        if (dataOneWay.status === 'success' && dataOneWay.mappings) {
            mappingsOneWay = dataOneWay.mappings;
        }

        // Verificar si hay al menos un mapeo
        const hasMappings = Object.keys(mappingsNormal).length > 0 || Object.keys(mappingsOneWay).length > 0;
        
        return { hasMappings, error: null };
    } catch (error) {
        console.error('Error verificando mapeos del dominio:', error);
        // En caso de error, permitir continuar (por si hay problemas de red)
        return { hasMappings: true, error: error.message };
    }
}

// Función para mostrar el modal de dominio no mapeado
function showDomainNotMappedModal(domain) {
    const modal = document.getElementById('domainNotMappedModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Función para ocultar el modal de dominio no mapeado
function hideDomainNotMappedModal() {
    const modal = document.getElementById('domainNotMappedModal');
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

        // Verificar si el dominio tiene mapeos
        showStatus(ui, 'Verificando mapeos del dominio...', 'info');
        const mappingCheck = await checkDomainMappings(domain, apiKey, reservationType);

        if (!mappingCheck.hasMappings) {
            // No hay mapeos, mostrar el disclaimer
            showDomainNotMappedModal(domain);
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

// Campos específicos de Gesintur para reserva_billete (según documento)
// Campos de Gesintur se obtienen del backend (no hardcodeados)

// --- HELPERS (Manipulación del DOM) ---
function buildMultiEditableForm(ui, reservationsData) {
    // 1. Limpiar el contenedor de cualquier formulario anterior.
    ui.standardFieldsContainer.innerHTML = ''; 
    
    // 2. Iterar sobre cada reserva encontrada y construir su sección en el formulario.
    reservationsData.forEach((data, index) => {
        // DETERMINAR EL TIPO DE SERVICIO (Fundamental para el mapeo dinámico)
        // Priorizamos el tipo que viene en la data, si no, el seleccionado en el popup
        const resType = data.reservation_type || selectedReservationType || 'aereo';
        
        // SELECCIONAR LISTA DE CAMPOS (De allServiceFields cargado en initializeCaptureTab)
        const fieldsToRender = ALL_SERVICE_FIELDS[resType] || STANDARD_FIELDS;

        // Crear el contenedor principal para esta reserva.
        const wrapper = document.createElement('div');
        wrapper.className = 'reservation-form-wrapper';
        
        // Crear el título de la reserva incluyendo el tipo de servicio para mayor claridad
        const title = document.createElement('h3');
        const displayType = resType.replace(/_/g, ' ').toUpperCase();
        title.textContent = `${displayType} - Reserva ${index + 1} (${data.codigo_reserva || 'Sin código'})`;
        wrapper.appendChild(title);

        // 3. CONTENEDOR DE CAMPOS EN GRID DE 2 COLUMNAS
        const fieldsGridContainer = document.createElement('div');
        fieldsGridContainer.className = 'fields-grid-container';

        // 3. CAMPOS DINÁMICOS: Dibujar según el tipo de servicio (Hotel, Tren, etc.)
        fieldsToRender.forEach(field => {
            // No dibujamos 'pasajeros' y 'num_pasajeros' aquí porque tienen lógica especial de tabla/lista abajo
            if (field === 'pasajeros' || field === 'num_pasajeros') return;

            const fieldElement = createFieldElement(field, data[field], index);
            if (fieldElement) {
                fieldsGridContainer.appendChild(fieldElement);
            }
        });
        
        // Agregar el contenedor de grid al wrapper
        wrapper.appendChild(fieldsGridContainer);
        
        // 4. LÓGICA DE PASAJEROS (Si existen en este tipo de servicio) - Fuera del grid
        if (fieldsToRender.includes('pasajeros') && data.pasajeros) {
            const passengersElement = createFieldElement('pasajeros', data.pasajeros, index);
            if (passengersElement) wrapper.appendChild(passengersElement);
        }

        // --- SECCIONES DE INTEGRACIÓN (AVSIS, GESINTUR, ORBISWEB) ---

        // A) Lógica de Billetaje (Solo si Gesintur está activo y el tipo es billetaje)
        if (cachedGesinturStatus && resType === 'billetaje') {
            const billetageContainer = document.createElement('div');
            billetageContainer.className = 'billetage-fields-container';
            billetageContainer.style.cssText = 'margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ccc;';
            
            const bTitle = document.createElement('h4');
            bTitle.textContent = 'Campos adicionales de Billetaje';
            bTitle.style.cssText = 'font-size: 14px; color: #0672ff; margin-bottom: 12px;';
            billetageContainer.appendChild(bTitle);
            
            const billetageFieldsDiv = document.createElement('div');
            billetageFieldsDiv.className = 'fields-grid-container';
            
            BILLETAGE_FIELDS.forEach(field => {
                billetageFieldsDiv.appendChild(createFieldElement(field, data[field], index));
            });
            billetageContainer.appendChild(billetageFieldsDiv);
            wrapper.appendChild(billetageContainer);
        }

        // B) Integración con AVSIS
        if (cachedAvsisStatus) {
            const avsisContainer = document.createElement('div');
            avsisContainer.className = 'avsis-fields-container';
            const toggleLink = document.createElement('a');
            toggleLink.href = '#';
            toggleLink.textContent = 'Mostrar campos AVSIS';
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            fieldsDiv.style.display = 'none';
            
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                const isHidden = fieldsDiv.style.display === 'none';
                fieldsDiv.style.display = isHidden ? 'grid' : 'none';
                e.target.textContent = isHidden ? 'Ocultar campos AVSIS' : 'Mostrar campos AVSIS';
                notifySizeChange();
            });
            
            avsisContainer.appendChild(toggleLink);
            AVSIS_SPECIFIC_FIELDS.forEach(field => {
                fieldsDiv.appendChild(createFieldElement(field, data[field], index));
            });
            avsisContainer.appendChild(fieldsDiv);
            wrapper.appendChild(avsisContainer);
        }

        // C) Integración con Gesintur
        if (cachedGesinturStatus) {
            const gesinturContainer = document.createElement('div');
            gesinturContainer.className = 'gesintur-fields-container';
            const toggleLink = document.createElement('a');
            toggleLink.href = '#';
            toggleLink.textContent = 'Mostrar campos Gesintur';
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            fieldsDiv.style.display = 'none';
            
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                const isHidden = fieldsDiv.style.display === 'none';
                fieldsDiv.style.display = isHidden ? 'grid' : 'none';
                e.target.textContent = isHidden ? 'Ocultar campos Gesintur' : 'Mostrar campos Gesintur';
                notifySizeChange();
            });
            
            gesinturContainer.appendChild(toggleLink);
            const gesinturFields = (resType === 'billetaje') ? GESINTUR_BILETE_FIELDS : GESINTUR_NORMAL_FIELDS;
            
            gesinturFields.forEach(field => {
                const fieldElement = createFieldElement(field, data[field], index);
                const input = fieldElement.querySelector('input, select, textarea');
                if (input) {
                    input.id = `gesintur_${field}_${index}`;
                    input.name = `gesintur_${field}_${index}`;
                }
                fieldsDiv.appendChild(fieldElement);
            });
            gesinturContainer.appendChild(fieldsDiv);
            wrapper.appendChild(gesinturContainer);
        }

        // D) Integración con ORBISWEB/Pipeline
        if (cachedOrbiswebStatus) {
            const pipelineContainer = document.createElement('div');
            pipelineContainer.className = 'pipeline-fields-container';
            const toggleLink = document.createElement('a');
            toggleLink.href = '#';
            toggleLink.textContent = 'Mostrar campos ORBISWEB';
            const fieldsDiv = document.createElement('div');
            fieldsDiv.className = 'fields-grid-container';
            fieldsDiv.style.display = 'none';
            
            toggleLink.addEventListener('click', (e) => {
                e.preventDefault();
                const isHidden = fieldsDiv.style.display === 'none';
                fieldsDiv.style.display = isHidden ? 'grid' : 'none';
                e.target.textContent = isHidden ? 'Ocultar campos ORBISWEB' : 'Mostrar campos ORBISWEB';
                notifySizeChange();
            });
            
            pipelineContainer.appendChild(toggleLink);
            PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                const fieldElement = createFieldElement(field, data[field], index);
                const input = fieldElement.querySelector('input, select, textarea');
                if (input) {
                    input.id = `pipeline_${field}_${index}`;
                    input.name = `pipeline_${field}_${index}`;
                    
                    // Validación especial para campos obligatorios de Orbis
                    const requiredOrbis = ['numidsucursal', 'strlocalizadorpnr', 'strlocalizadorgds'];
                    // También marcar como requerido cualquier campo que contenga "clase" (campo clase de ORBISWEB)
                    const isClaseField = field.toLowerCase().includes('clase');
                    if (requiredOrbis.includes(field.toLowerCase()) || isClaseField) {
                        input.required = true;
                        input.setAttribute('data-required-orbisweb', 'true');
                        const label = fieldElement.querySelector('label');
                        if (label) label.innerHTML += ' <span style="color: red;">*</span>';
                    }
                }
                fieldsDiv.appendChild(fieldElement);
            });
            pipelineContainer.appendChild(fieldsDiv);
            wrapper.appendChild(pipelineContainer);
        }

        // 5. BOTÓN DE ACCIÓN INDIVIDUAL
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Guardar Cambios';
        saveBtn.className = 'save-single-reservation-btn';
        // Se activa solo tras el "Guardar Todo" inicial
        saveBtn.disabled = true; 
        saveBtn.title = "Primero debes usar 'Guardar Todo' para registrar esta reserva.";
        saveBtn.addEventListener('click', () => updateSingleReservation(ui, index)); 
        wrapper.appendChild(saveBtn);
        
        ui.standardFieldsContainer.appendChild(wrapper);
    });

    // 6. GESTIÓN FINAL DE VISIBILIDAD
    ui.formContainer.style.display = 'block';
    ui.capturarReservaBtn.style.display = 'none';
    ui.globalActionsRow.style.display = 'flex';
    ui.saveAllBtn.style.display = 'inline-block';
    ui.discardBtn.style.display = 'inline-block';
    ui.clearBtn.style.display = 'none';
    ui.saveAllBtn.disabled = false;

    // Notificar cambio de tamaño al iframe
    notifySizeChange();
}

async function saveAllNewReservations(ui) {
    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        alert("Por favor, ingresa tu API Key.");
        return;
    }
    
    // Validar campos requeridos de orbisweb antes de guardar
    console.log("🔍 Validando orbisweb - cachedOrbiswebStatus:", cachedOrbiswebStatus);
    if (cachedOrbiswebStatus) {
        const validationError = validateAllOrbiswebRequiredFields();
        console.log("🔍 Resultado de validación:", validationError);
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
        // --- INICIO DE LA CORRECCIÓN PARA CAPTURAR EDICIONES MANUALES ---
        // En lugar de hacer: let reservationsToSave = savedReservationData;
        // Creamos la lista llamando a tu función recolectora para cada reserva en pantalla
        let reservationsToSave = [];
        if (savedReservationData) {
            for (let i = 0; i < savedReservationData.length; i++) {
                const freshData = await collectSingleFieldData(i); // Esto captura lo que escribiste en el input
                reservationsToSave.push(freshData);
            }
        }
        // --- FIN DE LA CORRECCIÓN ---

        // Asegurar que cada reserva tenga reservation_type y num_pax como entero
        if (reservationsToSave) {
            reservationsToSave = reservationsToSave.map((reservation, index) => {
                const reservationData = { ...reservation };
                // Incluir reservation_type si no está presente
                if (!reservationData.reservation_type) {
                    reservationData.reservation_type = selectedReservationType || reservation.reservation_type || 'aereo';
                }
                
                // Calcular num_pax como entero desde el array de pasajeros o num_pasajeros
                if (reservationData.pasajeros && Array.isArray(reservationData.pasajeros)) {
                    reservationData.num_pax = parseInt(reservationData.pasajeros.length) || 0;
                } else if (reservationData.num_pasajeros) {
                    // Si existe num_pasajeros, convertirlo a entero y asignarlo también como num_pax
                    reservationData.num_pax = parseInt(reservationData.num_pasajeros) || 0;
                    reservationData.num_pasajeros = reservationData.num_pax; // También asegurar que num_pasajeros sea entero
                } else {
                    reservationData.num_pax = 0;
                }
                
                return reservationData;
            });
        }
        
        // Lógica de Gesintur (Tu lógica original)
        if (cachedGesinturStatus && reservationsToSave) {
            reservationsToSave = reservationsToSave.map((reservation, index) => {
                const reservationData = { ...reservation };
                const reservationType = reservationData.reservation_type || selectedReservationType || 'aereo';
                const isBilletaje = reservationType === 'billetaje';
                const gesinturFields = isBilletaje ? GESINTUR_BILETE_FIELDS : GESINTUR_NORMAL_FIELDS;
                
                // Recolectar campos específicos de Gesintur
                gesinturFields.forEach(field => {
                    const inputElement = document.getElementById(`gesintur_${field}_${index}`);
                    if (inputElement) {
                        const value = inputElement.value.trim();
                        if (value !== '') {
                            // Convertir campos numéricos
                            if (field.includes('venta_') || field.includes('coste_') || field === 'markup' || field === 'fee') {
                                const numValue = parseFloat(value);
                                reservationData[field] = isNaN(numValue) ? 0 : numValue;
                            } else {
                                reservationData[field] = value;
                            }
                        }
                    }
                });
                
                return reservationData;
            });
        }
        
        // Lógica de Pipeline/ORBISWEB (Tu lógica original)
        if (cachedOrbiswebStatus && reservationsToSave) {
            const missingNumidsucursal = [];
            
            reservationsToSave = reservationsToSave.map((reservation, index) => {
                const reservationData = { ...reservation };
                
                // Recolectar campos específicos de Pipeline/ORBISWEB
                const requiredFields = ['numidsucursal', 'strlocalizadorpnr', 'strlocalizadorgds'];
                
                PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                    const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                    if (inputElement) {
                        const value = inputElement.value.trim();
                        if (value !== '') {
                            // Convertir campos numéricos
                            if (field.toLowerCase().startsWith('num') || field.toLowerCase().startsWith('b')) {
                                const numValue = parseFloat(value);
                                reservationData[field] = isNaN(numValue) ? 0 : numValue;
                            } else {
                                reservationData[field] = value;
                            }
                        } else {
                            // Validar campos requeridos: los de la lista Y cualquier campo que contenga "clase"
                            const isRequired = requiredFields.includes(field.toLowerCase()) || field.toLowerCase().includes('clase');
                            if (isRequired) {
                                if (!missingNumidsucursal.includes(index + 1)) {
                                    missingNumidsucursal.push(index + 1);
                                }
                            }
                        }
                    } else {
                        // Validar campos requeridos: los de la lista Y cualquier campo que contenga "clase"
                        const isRequired = requiredFields.includes(field.toLowerCase()) || field.toLowerCase().includes('clase');
                        if (isRequired) {
                            if (!missingNumidsucursal.includes(index + 1)) {
                                missingNumidsucursal.push(index + 1);
                            }
                        }
                    }
                });
                
                return reservationData;
            });
            
            // Validar campos faltantes (Tu lógica original)
            if (missingNumidsucursal.length > 0) {
                showSpinner(ui, false);
                ui.saveAllBtn.disabled = false;
                showStatus(ui, `⚠️ Hay campos obligatorios de ORBISWEB sin completar en la(s) reserva(s): ${missingNumidsucursal.join(', ')}. Por favor, completa todos los campos requeridos.`, 'error');
                
                const requiredFields = ['numidsucursal', 'strlocalizadorpnr', 'strlocalizadorgds'];
                missingNumidsucursal.forEach(reservationNum => {
                    const index = reservationNum - 1;
                    // Validar campos requeridos: los de la lista Y cualquier campo que contenga "clase"
                    PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                        const isRequired = requiredFields.some(rf => field.toLowerCase() === rf.toLowerCase()) || field.toLowerCase().includes('clase');
                        if (isRequired) {
                                const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                                if (inputElement && inputElement.value.trim() === '') {
                                    validateOrbiswebRequiredField(inputElement);
                                    const pipelineContainer = inputElement.closest('.pipeline-fields-container');
                                    if (pipelineContainer) {
                                        const fieldsDiv = pipelineContainer.querySelector('div[style*="display: none"]');
                                        if (fieldsDiv) {
                                            fieldsDiv.style.display = 'block';
                                            const toggleLink = pipelineContainer.querySelector('a');
                                            if (toggleLink) toggleLink.textContent = 'Ocultar campos Pipeline/ORBISWEB';
                                        }
                                    }
                                }
                            }
                        });
                    });
                return; 
            }
        }

        const response = await chrome.runtime.sendMessage({
            action: 'saveAllReservations', 
            apiKey: apiKey,
            reservationsData: reservationsToSave 
        });

        if (response.status === 'ok') {
            showStatus(ui, `${response.message} | Tokens restantes: ${response.tokens_remaining}`, 'success');
            
            ui.saveAllBtn.style.display = 'none';
            ui.discardBtn.style.display = 'none';
            ui.clearBtn.style.display = 'inline-block';

            document.querySelectorAll('.save-single-reservation-btn').forEach(btn => {
                btn.disabled = false;
                btn.title = "Guardar cambios en esta reserva (sin coste de token)";
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

function createFieldElement(fieldName, value, index) {
    const fieldId = `${fieldName}_${index}`;
    const group = document.createElement('div');
    group.className = 'field-group';

    const label = document.createElement('label');
    label.setAttribute('for', fieldId);
    label.textContent = fieldName.replace(/is_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    if (fieldName.startsWith('is_')) {
        // Ocultar checkboxes de is_residente e is_familia_numerosa
        if (fieldName === 'is_residente' || fieldName === 'is_familia_numerosa') {
            // No crear ningún elemento para estos campos
            return null;
        }
        
        group.classList.add('field-group-switch');
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = fieldId;
        input.checked = value === true || value === 'true';
        
        const slider = document.createElement('span');
        slider.className = 'slider round';

        switchLabel.appendChild(input);
        switchLabel.appendChild(slider);
        group.appendChild(label);
        group.appendChild(switchLabel);

    } else if (fieldName === 'pasajeros' && Array.isArray(value)) {
        group.classList.add('field-group-details');
        
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `Ver/Ocultar ${value.length} Pasajero(s)`;
        details.appendChild(summary);

        const passengerList = document.createElement('div');
        passengerList.className = 'passenger-list';
        
        value.forEach((pax, paxIndex) => {
            const paxDiv = document.createElement('div');
            paxDiv.className = 'passenger-item';
            let seatInfo = '';
            if (pax.asiento_ida) seatInfo += ` | Ida: ${pax.asiento_ida}`;
            if (pax.asiento_vuelta) seatInfo += ` | Vuelta: ${pax.asiento_vuelta}`;
            
            paxDiv.innerHTML = `<strong>Pasajero ${paxIndex + 1}:</strong> ${pax.nombre_pax || ''} ${pax.primer_apellidos_pax || ''}${seatInfo}`;
            passengerList.appendChild(paxDiv);
        });
        
        details.appendChild(passengerList);
        group.appendChild(label);
        group.appendChild(details);
        
        // Ajustar tamaño cuando se abre/cierra el <details>
        details.addEventListener('toggle', notifySizeChange);

    } else if (fieldName === 'tipo_residente') {
        // Crear select para tipo_residente
        const select = document.createElement('select');
        select.id = fieldId;
        select.name = fieldId;
        
        // Opciones para tipo_residente
        const opciones = [
            { value: '', text: '-- Seleccionar --' },
            { value: 'Sin descuento', text: 'Sin descuento' },
            { value: 'Residente islas o Ceuta (75%)', text: 'Residente islas o Ceuta (75%)' }
        ];
        
        opciones.forEach(opcion => {
            const option = document.createElement('option');
            option.value = opcion.value;
            option.textContent = opcion.text;
            select.appendChild(option);
        });
        
        // Intentar precargar el valor si existe y coincide exactamente
        if (value && value.trim() !== '') {
            const valorNormalizado = value.trim();
            // Buscar coincidencia exacta
            const opcionEncontrada = opciones.find(op => 
                op.value.toLowerCase() === valorNormalizado.toLowerCase() ||
                op.text.toLowerCase() === valorNormalizado.toLowerCase()
            );
            
            if (opcionEncontrada) {
                select.value = opcionEncontrada.value;
            } else {
                // Si no hay coincidencia exacta, dejar vacío
                select.value = '';
            }
        } else {
            select.value = '';
        }
        
        group.appendChild(label);
        group.appendChild(select);

    } else if (fieldName === 'tipo_familia_numerosa') {
        // Crear select para tipo_familia_numerosa
        const select = document.createElement('select');
        select.id = fieldId;
        select.name = fieldId;
        
        // Opciones para tipo_familia_numerosa
        const opciones = [
            { value: '', text: '-- Seleccionar --' },
            { value: 'Sin descuento', text: 'Sin descuento' },
            { value: 'Fam. numerosa general (5%)', text: 'Fam. numerosa general (5%)' },
            { value: 'Fam. numerosa especial (10%)', text: 'Fam. numerosa especial (10%)' },
            { value: 'Fam. numerosa general residente (80%)', text: 'Fam. numerosa general residente (80%)' },
            { value: 'Fam. numerosa especial residente (85%)', text: 'Fam. numerosa especial residente (85%)' }
        ];
        
        opciones.forEach(opcion => {
            const option = document.createElement('option');
            option.value = opcion.value;
            option.textContent = opcion.text;
            select.appendChild(option);
        });
        
        // Intentar precargar el valor si existe y coincide exactamente
        if (value && value.trim() !== '') {
            const valorNormalizado = value.trim();
            // Buscar coincidencia exacta
            const opcionEncontrada = opciones.find(op => 
                op.value.toLowerCase() === valorNormalizado.toLowerCase() ||
                op.text.toLowerCase() === valorNormalizado.toLowerCase()
            );
            
            if (opcionEncontrada) {
                select.value = opcionEncontrada.value;
            } else {
                // Si no hay coincidencia exacta, dejar vacío
                select.value = '';
            }
        } else {
            select.value = '';
        }
        
        group.appendChild(label);
        group.appendChild(select);

    } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.name = fieldId;
        input.value = value || '';
        group.appendChild(label);
        group.appendChild(input);
    }
    
    return group;
}


async function collectSingleFieldData(index) {
    const data = {};
    
    // 1. Obtener los datos base y el tipo de servicio para esta reserva específica
    const { savedReservationData } = await chrome.storage.local.get('savedReservationData');
    const reservationType = savedReservationData?.[index]?.reservation_type || selectedReservationType || 'aereo';
    
    // 2. Construir la lista de campos que debemos buscar en la interfaz (DOM)
    // Empezamos con los campos estándar
    let fieldsToCollect = [...STANDARD_FIELDS];
    
    // AGREGAR CAMPOS ESPECÍFICOS DEL SERVICIO (Hotel, Rent a Car, Tren)
    // Esto es lo que faltaba: permite recolectar campos como fecha_check_in, nombre_hotel, etc.
    if (typeof ALL_SERVICE_FIELDS !== 'undefined' && ALL_SERVICE_FIELDS[reservationType]) {
        fieldsToCollect = [...fieldsToCollect, ...ALL_SERVICE_FIELDS[reservationType]];
    }
    
    // Agregar campos si hay integraciones activas
    if (cachedGesinturStatus && reservationType === 'billetaje') {
        fieldsToCollect = [...fieldsToCollect, ...BILLETAGE_FIELDS];
    }
    
    if (cachedAvsisStatus) {
        fieldsToCollect = [...fieldsToCollect, ...AVSIS_SPECIFIC_FIELDS];
    }
    
    // Usamos Set para eliminar duplicados de llaves si los hubiera
    fieldsToCollect = [...new Set(fieldsToCollect)];
    
    // 3. RECOLECTAR VALORES DE LOS INPUTS DINÁMICOS
    fieldsToCollect.forEach(field => {
        if (field === 'pasajeros') return; // Se maneja aparte abajo
        
        const inputElement = document.getElementById(`${field}_${index}`);
        if (inputElement) {
            if (inputElement.type === 'checkbox') {
                data[field] = inputElement.checked;
            } else {
                const value = inputElement.value.trim();
                // Convertir num_pasajeros a entero
                if (field === 'num_pasajeros' && value !== '') {
                    data[field] = parseInt(value) || 0;
                } else {
                    // Capturamos el valor actual (incluyendo lo que el usuario escribió a mano)
                    data[field] = value === '' ? null : value;
                }
            }
        }
    });
    
    // 4. RECOLECTAR CAMPOS CON PREFIJO 'gesintur_' SI LA INTEGRACIÓN ESTÁ ACTIVA
    if (cachedGesinturStatus) {
        const isBilletaje = reservationType === 'billetaje';
        const gesinturFields = isBilletaje ? GESINTUR_BILETE_FIELDS : GESINTUR_NORMAL_FIELDS;
        
        gesinturFields.forEach(field => {
            const inputElement = document.getElementById(`gesintur_${field}_${index}`);
            if (inputElement) {
                const value = inputElement.value.trim();
                if (value !== '') {
                    // Conversión numérica para campos de moneda o porcentajes
                    if (field.includes('venta_') || field.includes('coste_') || field === 'markup' || field === 'fee') {
                        data[field] = parseFloat(value) || 0;
                    } else {
                        data[field] = value;
                    }
                }
            }
        });
    }
    
    // 5. RECOLECTAR CAMPOS CON PREFIJO 'pipeline_' SI ORBISWEB ESTÁ ACTIVA
    if (cachedOrbiswebStatus) {
        if (typeof PIPELINE_ORBISWEB_FIELDS !== 'undefined') {
            PIPELINE_ORBISWEB_FIELDS.forEach(field => {
                const inputElement = document.getElementById(`pipeline_${field}_${index}`);
                if (inputElement) {
                    const value = inputElement.value.trim();
                    if (value !== '') {
                        // Conversión numérica según prefijos de Orbis
                        if (field.toLowerCase().startsWith('num') || field.toLowerCase().startsWith('b')) {
                            data[field] = parseFloat(value) || 0;
                        } else {
                            data[field] = value;
                        }
                    }
                }
            });
        }
    }

    // 6. ASIGNAR METADATOS Y DATOS ESTRUCTURADOS
    data.reservation_type = reservationType;
    
    // Mantener la lista de pasajeros original si existe
    if (savedReservationData && savedReservationData[index] && savedReservationData[index].pasajeros) {
        data.pasajeros = savedReservationData[index].pasajeros;
    }
    
    // Calcular num_pax como entero desde el array de pasajeros
    if (data.pasajeros && Array.isArray(data.pasajeros)) {
        data.num_pax = parseInt(data.pasajeros.length) || 0;
    } else if (data.num_pasajeros) {
        // Si existe num_pasajeros, convertirlo a entero y asignarlo también como num_pax
        data.num_pax = parseInt(data.num_pasajeros) || 0;
        data.num_pasajeros = data.num_pax; // También asegurar que num_pasajeros sea entero
    } else {
        data.num_pax = 0;
    }

    return data;
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
    if (!cachedOrbiswebStatus) {
        return null;
    }
    
    const requiredFields = ['numidsucursal', 'strlocalizadorpnr', 'strlocalizadorgds'];
    const missingFieldsByReservation = {}; // { index: [fieldNames] }
    
    // Buscar TODOS los inputs con ID que contenga "pipeline" y alguno de los campos requeridos (case-insensitive)
    const allPipelineInputs = Array.from(document.querySelectorAll('input[id*="pipeline"], select[id*="pipeline"], textarea[id*="pipeline"]'));
    console.log("🔍 Total inputs pipeline encontrados:", allPipelineInputs.length);
    
    allPipelineInputs.forEach((input) => {
        const inputIdLower = input.id.toLowerCase();
        
        // Verificar si es uno de los campos requeridos O si contiene "clase"
        const isRequiredField = requiredFields.some(rf => inputIdLower.includes(rf.toLowerCase())) || inputIdLower.includes('clase');
        
        if (isRequiredField) {
            // Extraer el índice del ID
            const match = input.id.match(/pipeline_[^_]*_(\d+)$/i);
            if (match) {
                const index = parseInt(match[1]);
                const reservationNum = index + 1;
                
                console.log(`🔍 Validando ${input.id}, valor: "${input.value}"`);
                
                if (input.value.trim() === '') {
                    if (!missingFieldsByReservation[reservationNum]) {
                        missingFieldsByReservation[reservationNum] = [];
                    }
                    
                    // Obtener el nombre del campo para mostrar en el mensaje
                    const fieldName = PIPELINE_ORBISWEB_FIELDS.find(f => 
                        input.id.toLowerCase().includes(f.toLowerCase())
                    ) || 'campo requerido';
                    missingFieldsByReservation[reservationNum].push(fieldName);
                    
                    // Marcar visualmente el error
                    validateOrbiswebRequiredField(input);
                    
                    // Expandir la sección si está oculta
                    const pipelineContainer = input.closest('.pipeline-fields-container');
                    if (pipelineContainer) {
                        const fieldsDiv = pipelineContainer.querySelector('div[style*="display: none"]');
                        if (fieldsDiv) {
                            fieldsDiv.style.display = 'block';
                            const toggleLink = pipelineContainer.querySelector('a');
                            if (toggleLink) {
                                toggleLink.textContent = 'Ocultar campos Pipeline/ORBISWEB';
                            }
                        }
                    }
                    
                    // Scroll y focus al primer campo con error
                    if (Object.keys(missingFieldsByReservation).length === 1 && missingFieldsByReservation[reservationNum].length === 1) {
                        setTimeout(() => {
                            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            input.focus();
                        }, 100);
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
    if (!cachedOrbiswebStatus) return null;
    
    const requiredFields = ['numidsucursal', 'strlocalizadorpnr', 'strlocalizadorgds'];
    const missingFields = [];
    
    // Buscar todos los campos requeridos: los de la lista Y cualquier campo que contenga "clase"
    PIPELINE_ORBISWEB_FIELDS.forEach(field => {
        const isRequired = requiredFields.some(rf => field.toLowerCase() === rf.toLowerCase()) || field.toLowerCase().includes('clase');
        if (isRequired) {
            const inputElement = document.getElementById(`pipeline_${field}_${index}`);
            if (inputElement && inputElement.value.trim() === '') {
                missingFields.push(field);
                validateOrbiswebRequiredField(inputElement);
                // Hacer scroll al campo si está oculto
                const fieldsDiv = inputElement.closest('.pipeline-fields-container')?.querySelector('div[style*="display: none"]');
                if (fieldsDiv) {
                    fieldsDiv.style.display = 'block';
                    const toggleLink = inputElement.closest('.pipeline-fields-container')?.querySelector('a');
                    if (toggleLink) {
                        toggleLink.textContent = 'Ocultar campos Pipeline/ORBISWEB';
                    }
                }
                if (missingFields.length === 1) {
                    inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    inputElement.focus();
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
    // El statusDiv ahora es común, así que está bien
    ui.statusDiv.textContent = message;
    ui.statusDiv.className = `status-${type}`;
    ui.statusDiv.style.display = 'block';
}

function showSpinner(ui, show) {
    ui.spinner.style.display = show ? 'block' : 'none';
    ui.capturarReservaBtn.disabled = show;
    document.querySelectorAll('.save-single-reservation-btn').forEach(btn => btn.disabled = show);
    if(ui.clearBtn) ui.clearBtn.disabled = show;
}

function clearFormDOM(ui) {
    ui.standardFieldsContainer.innerHTML = '';
    ui.formContainer.style.display = 'none';
    ui.globalActionsRow.style.display = 'none';
}

// ============================================================================
// Manual Field Mapping System - Phase 1
// ============================================================================

let currentMappings = {};
let allFieldsList = [];
let pendingMapping = null;

// English field labels (user-friendly names)
const FIELD_LABELS_EN = {
    // Main Info
    "localizador": "Alternative Locator",
    "codigo_reserva": "Booking Code",
    "estado_booking": "Status",
    "is_confirmada": "Confirmed",
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

// Helper function to get English label for a field
function getFieldLabel(fieldName) {
    return FIELD_LABELS_EN[fieldName] || fieldName;
}

// Initialize mapping UI
function initializeMappingUI(ui) {
    // Get current tab domain
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url) {
            try {
                const url = new URL(tabs[0].url);
                ui.mappingDomain.value = url.hostname;
            } catch (e) {
                console.error('Error parsing URL:', e);
            }
        }
    });
    
    // Check if there's a pending element selection from quick mode or saved state
    chrome.storage.local.get(['pendingElementMapping', 'pendingMappingState', 'mappingDialogVisible'], (result) => {
        console.log('POPUP: Checking for pending mappings:', result);
        
        if (result.pendingElementMapping) {
            // Show field selection dialog for the selected element
            showFieldSelectionForElement(ui, result.pendingElementMapping);
            // Clear the pending mapping
            chrome.storage.local.remove(['pendingElementMapping']);
        }
        
        // Restore pending mapping state if it exists (from minimized popup or closed popup)
        if (result.pendingMappingState) {
            console.log('POPUP: Restoring pending mapping state:', result.pendingMappingState);
            pendingMapping = result.pendingMappingState;
            // Clear the stored state first to avoid showing multiple times
            chrome.storage.local.remove(['pendingMappingState', 'mappingDialogVisible'], () => {
                // Always show the confirmation dialog when restoring
                setTimeout(() => {
                    showMappingConfirmation(ui, pendingMapping);
                }, 200); // Small delay to ensure UI is ready
            });
        }
    });
    
    // Load fields definition
    chrome.runtime.sendMessage({ action: 'getFieldsDefinition' })
        .then(data => {
            if (data.status === 'success') {
                allFieldsList = [...(data.standard_fields || []), ...(data.avsis_fields || [])];
                renderMappingFields(ui);
            }
        })
        .catch(err => {
            console.error('Error loading fields definition:', err);
            showStatus(ui, 'Error loading field definitions', 'error');
        });
    
    // Event listeners
    if (ui.loadMappingsBtn) {
        ui.loadMappingsBtn.addEventListener('click', () => loadMappings(ui));
    }
    if (ui.confirmMappingBtn) {
        ui.confirmMappingBtn.addEventListener('click', () => confirmMapping(ui));
    }
    if (ui.cancelMappingBtn) {
        ui.cancelMappingBtn.addEventListener('click', () => cancelMapping(ui));
    }
    
    // Restore dialog button
    const restoreBtn = document.getElementById('restoreMappingDialogBtn');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', () => restoreMappingDialog(ui));
    }
    
    // Minimize popup button (always visible in mapping tab)
    const minimizePopupBtn = document.getElementById('minimizeMappingPopupBtn');
    if (minimizePopupBtn) {
        minimizePopupBtn.addEventListener('click', () => {
            // Save pending mapping state before closing
            if (pendingMapping) {
                chrome.storage.local.set({ 
                    pendingMappingState: pendingMapping,
                    mappingDialogVisible: ui.mappingConfirmDialog?.style.display === 'block'
                });
            }
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'closeUI' });
            });
        });
    }
    
    // Listen for element selection from content script (set up globally, not just in this function)
    setupMappingMessageListener(ui);
}

// Set up global message listener for mapping (called once)
let mappingMessageListenerSetup = false;
function setupMappingMessageListener(ui) {
    if (mappingMessageListenerSetup) return; // Only set up once
    
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log('POPUP: Received message:', request);
        if (request.action === 'elementSelectedForMapping') {
            console.log('POPUP: Element selected for mapping:', request.fieldName);
            // Always save the state first
            chrome.storage.local.set({ 
                pendingMappingState: request,
                mappingDialogVisible: true
            }, () => {
                console.log('POPUP: Saved mapping state');
            });
            
            // Check if we're in the mapping tab
            const mappingContent = document.getElementById('mappingContent');
            if (mappingContent && mappingContent.classList.contains('active')) {
                // We're in the mapping tab, show the dialog directly
                console.log('POPUP: In mapping tab, showing dialog immediately');
                showMappingConfirmation(ui, request);
            } else {
                console.log('POPUP: Not in mapping tab, state saved for when tab is opened');
            }
        }
        return true;
    });
    
    mappingMessageListenerSetup = true;
}

// Show field selection dialog when element is clicked in quick mode
function showFieldSelectionForElement(ui, elementData) {
    // Create a modal to select which field to map
    const modal = document.createElement('div');
    modal.id = 'fieldSelectionModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        padding: 20px;
        border-radius: 8px;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
    `;
    
    modalContent.innerHTML = `
        <h3 style="margin-top: 0; color: #0672ff;">Select Field to Map</h3>
        <p><strong>Selector:</strong></p>
        <code style="display: block; background: #f5f5f5; padding: 8px; border-radius: 4px; margin: 5px 0; word-break: break-all; font-size: 12px;">${elementData.selector}</code>
        <p><strong>Example Value:</strong></p>
        <code style="display: block; background: #e6ffe6; padding: 8px; border-radius: 4px; margin: 5px 0; word-break: break-all; font-size: 12px;">${elementData.previewValue || '(no value)'}</code>
        <label style="display: block; margin-top: 15px; font-weight: bold;">Mapping Type:</label>
        <select id="quickMappingType" style="width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ccc; border-radius: 4px;">
            <option value="capture">Capture (Read data)</option>
            <option value="autofill">Autofill (Write data)</option>
        </select>
        <label style="display: block; margin-top: 15px; font-weight: bold;">Field:</label>
        <select id="quickMappingField" style="width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ccc; border-radius: 4px; max-height: 200px;">
            ${allFieldsList.length > 0 ? allFieldsList.map(field => {
                const label = getFieldLabel(field);
                return `<option value="${field}">${label} (${field})</option>`;
            }).join('') : '<option>Loading fields...</option>'}
        </select>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button id="quickConfirmBtn" style="flex: 1; background-color: #28a745; border-color: #28a745; color: white; padding: 10px; border-radius: 4px; cursor: pointer;">Confirm</button>
            <button id="quickCancelBtn" style="flex: 1; background-color: #dc3545; border-color: #dc3545; color: white; padding: 10px; border-radius: 4px; cursor: pointer;">Cancel</button>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Wait for fields to load if needed
    if (allFieldsList.length === 0) {
        const checkFields = setInterval(() => {
            if (allFieldsList.length > 0) {
                clearInterval(checkFields);
                const select = document.getElementById('quickMappingField');
                if (select) {
                    select.innerHTML = allFieldsList.map(field => {
                        const label = getFieldLabel(field);
                        return `<option value="${field}">${label} (${field})</option>`;
                    }).join('');
                }
            }
        }, 100);
    }
    
    document.getElementById('quickConfirmBtn').addEventListener('click', () => {
        const fieldName = document.getElementById('quickMappingField').value;
        const fieldType = document.getElementById('quickMappingType').value;
        
        if (!fieldName || fieldName === 'Loading fields...') {
            alert('Please select a field');
            return;
        }
        
        // Store the mapping data and show confirmation
        pendingMapping = {
            ...elementData,
            fieldName: fieldName,
            fieldType: fieldType
        };
        
        modal.remove();
        showMappingConfirmation(ui, pendingMapping);
    });
    
    document.getElementById('quickCancelBtn').addEventListener('click', () => {
        modal.remove();
    });
}

// Load existing mappings
async function loadMappings(ui) {
    const domain = ui.mappingDomain.value.trim();
    const fieldType = ui.mappingType.value;
    const apiKey = ui.apiKeyInput.value.trim();
    
    if (!domain) {
        showStatus(ui, 'Please enter a domain', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus(ui, 'Please enter your API Key', 'error');
        return;
    }
    
    try {
        const data = await chrome.runtime.sendMessage({
            action: 'getFieldSelectors',
            apiKey: apiKey,
            domain: domain,
            fieldType: fieldType
        });
        
        if (data.status === 'success') {
            currentMappings = data.mappings || {};
            renderMappingFields(ui);
            showStatus(ui, `Loaded ${data.total_mappings} mappings for ${domain}`, 'success');
        } else {
            showStatus(ui, data.message || 'Error loading mappings', 'error');
        }
    } catch (error) {
        console.error('Error loading mappings:', error);
        showStatus(ui, 'Error loading mappings', 'error');
    }
}

// Render mapping fields list with enhanced UI
function renderMappingFields(ui) {
    const container = ui.mappingFieldsContainer;
    if (!container) return;
    
    container.innerHTML = '';
    
    if (allFieldsList.length === 0) {
        container.innerHTML = '<p class="status-text">Loading fields...</p>';
        return;
    }
    
    // Calculate progress
    const totalFields = allFieldsList.length;
    const mappedCount = Object.keys(currentMappings).length;
    const progressPercent = totalFields > 0 ? (mappedCount / totalFields) * 100 : 0;
    
    // Update progress indicator
    const progressDiv = document.getElementById('mappingProgress');
    const progressBar = document.getElementById('mappingProgressBar');
    const progressText = document.getElementById('mappingProgressText');
    
    if (progressDiv && progressBar && progressText) {
        progressDiv.style.display = 'block';
        progressBar.style.width = `${progressPercent}%`;
        progressText.textContent = `${mappedCount} / ${totalFields} fields mapped (${Math.round(progressPercent)}%)`;
        
        // Color based on progress
        if (progressPercent === 100) {
            progressBar.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        } else if (progressPercent >= 50) {
            progressBar.style.background = 'linear-gradient(90deg, #ffc107, #ff9800)';
        } else {
            progressBar.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
        }
    }
    
    // Enhanced field groups with more fields
    const fieldGroups = {
        'Main Info': ['localizador', 'codigo_reserva', 'estado_booking', 'is_confirmada', 'fecha_booking', 'fecha_emision', 'precio', 'divisa', 'forma_pago', 'proveedor', 'proveedor_codigo', 'tipo_servicio'],
        'Outbound Flight': ['aerolinea_ida', 'num_vuelo_ida', 'aeropuerto_salida_ida', 'fecha_ida', 'hora_salida', 'aeropuerto_llegada_ida', 'hora_llegada_ida'],
        'Return Flight': ['aerolinea_vuelta', 'num_vuelo_vuelta', 'aeropuerto_salida_vuelta', 'fecha_vuelta', 'hora_salida_vuelta', 'aeropuerto_llegada_vuelta', 'hora_llegada_vuelta', 'num_pasajeros_vuelta'],
        'Passengers': ['pasajeros', 'num_pasajeros', 'nombre_pax', 'primer_apellidos_pax', 'apellidos_pax'],
        'Economic': ['imp_total_coste', 'imp_total_venta', 'imp_mark_up', 'imp_cancelacion', 'imp_tasas', 'imp_total_tasas', 'imp_fee_servicio', 'imp_fee_emision'],
        'Other': []
    };
    
    // Add remaining fields to 'Other'
    allFieldsList.forEach(field => {
        let found = false;
        Object.values(fieldGroups).forEach(group => {
            if (group.includes(field)) found = true;
        });
        if (!found) fieldGroups['Other'].push(field);
    });
    
    Object.entries(fieldGroups).forEach(([groupName, fields]) => {
        if (fields.length === 0) return;
        
        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '20px';
        groupDiv.className = 'mapping-group';
        
        // Group header with stats
        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
        
        const groupTitle = document.createElement('h4');
        groupTitle.textContent = groupName;
        groupTitle.style.cssText = 'margin: 0; font-size: 14px; color: #0672ff; font-weight: bold;';
        
        // Count mapped fields in this group
        const groupMapped = fields.filter(f => currentMappings.hasOwnProperty(f)).length;
        const groupStats = document.createElement('span');
        groupStats.textContent = `${groupMapped}/${fields.length}`;
        groupStats.style.cssText = 'font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 8px; border-radius: 10px;';
        
        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(groupStats);
        groupDiv.appendChild(groupHeader);
        
        // Collapsible container
        const fieldsContainer = document.createElement('div');
        fieldsContainer.className = 'group-fields-container';
        
        fields.forEach(field => {
            const isMapped = currentMappings.hasOwnProperty(field);
            const mappingData = currentMappings[field];
            
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'mapping-field-item';
            fieldDiv.dataset.fieldName = field;
            fieldDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 10px; margin: 4px 0; border: 1px solid ${isMapped ? '#28a745' : '#ddd'}; border-radius: 4px; background: ${isMapped ? '#e6ffe6' : '#fff'}; transition: all 0.2s; cursor: pointer;`;
            
            // Add checkbox for batch selection (only for unmapped fields)
            if (!isMapped) {
                const batchCheckbox = document.createElement('input');
                batchCheckbox.type = 'checkbox';
                batchCheckbox.className = 'batch-select-checkbox';
                batchCheckbox.dataset.fieldName = field;
                batchCheckbox.style.cssText = 'margin-right: 8px; cursor: pointer;';
                batchCheckbox.style.display = 'none'; // Hidden by default
                
                // Toggle batch selection mode
                const batchSelectMode = document.getElementById('batchSelectMode');
                if (batchSelectMode) {
                    batchSelectMode.addEventListener('change', () => {
                        document.querySelectorAll('.batch-select-checkbox').forEach(cb => {
                            cb.style.display = batchSelectMode.checked ? 'block' : 'none';
                        });
                        const mapSelectedBtn = document.getElementById('mapSelectedBtn');
                        if (mapSelectedBtn) {
                            mapSelectedBtn.style.display = batchSelectMode.checked ? 'inline-block' : 'none';
                        }
                    });
                }
                
                fieldDiv.insertBefore(batchCheckbox, fieldDiv.firstChild);
                
                // Toggle selection on click
                fieldDiv.addEventListener('click', (e) => {
                    if (batchSelectMode && batchSelectMode.checked && e.target !== batchCheckbox && e.target.tagName !== 'BUTTON') {
                        batchCheckbox.checked = !batchCheckbox.checked;
                        fieldDiv.style.background = batchCheckbox.checked ? '#e6f7ff' : '#fff';
                        updateMapSelectedButton();
                    }
                });
            }
            
            const fieldLabelContainer = document.createElement('div');
            fieldLabelContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; min-width: 0;';
            
            const fieldLabelSpanish = document.createElement('span');
            fieldLabelSpanish.textContent = getFieldLabel(field);
            fieldLabelSpanish.style.cssText = 'font-weight: bold; color: #333; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            fieldLabelContainer.appendChild(fieldLabelSpanish);
            
            const fieldLabelTechnical = document.createElement('span');
            fieldLabelTechnical.textContent = field;
            fieldLabelTechnical.style.cssText = 'font-size: 11px; color: #666; font-style: italic;';
            fieldLabelContainer.appendChild(fieldLabelTechnical);
            
            // Show selector preview if mapped
            if (isMapped && mappingData && mappingData.selector_path) {
                const selectorPreview = document.createElement('span');
                selectorPreview.textContent = mappingData.selector_path.length > 40 ? mappingData.selector_path.substring(0, 40) + '...' : mappingData.selector_path;
                selectorPreview.style.cssText = 'font-size: 10px; color: #888; font-family: monospace; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
                selectorPreview.title = mappingData.selector_path;
                fieldLabelContainer.appendChild(selectorPreview);
            }
            
            fieldDiv.appendChild(fieldLabelContainer);
            
            // Action buttons container
            const actionsContainer = document.createElement('div');
            actionsContainer.style.cssText = 'display: flex; gap: 4px; align-items: center; flex-shrink: 0;';
            
            if (isMapped) {
                // View/Edit button
                const viewBtn = document.createElement('button');
                viewBtn.innerHTML = '👁️';
                viewBtn.title = 'View/Edit mapping';
                viewBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #17a2b8; border: none; color: white; border-radius: 4px; cursor: pointer;';
                viewBtn.addEventListener('click', () => viewEditMapping(ui, field, mappingData));
                actionsContainer.appendChild(viewBtn);
                
                // Test button
                const testBtn = document.createElement('button');
                testBtn.innerHTML = '✓';
                testBtn.title = 'Test selector';
                testBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #6c757d; border: none; color: white; border-radius: 4px; cursor: pointer;';
                testBtn.addEventListener('click', () => testSelector(ui, field, mappingData));
                actionsContainer.appendChild(testBtn);
                
                // Delete button
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.title = 'Delete mapping';
                deleteBtn.style.cssText = 'padding: 4px 8px; font-size: 12px; background-color: #dc3545; border: none; color: white; border-radius: 4px; cursor: pointer;';
                deleteBtn.addEventListener('click', () => deleteMapping(ui, field));
                actionsContainer.appendChild(deleteBtn);
            } else {
                // Map button
                const mapBtn = document.createElement('button');
                mapBtn.textContent = 'Map';
                mapBtn.style.cssText = 'padding: 4px 12px; font-size: 12px; background-color: #0672ff; border: none; color: white; border-radius: 4px; cursor: pointer;';
                mapBtn.addEventListener('click', () => startMapping(ui, field));
                actionsContainer.appendChild(mapBtn);
            }
            
            fieldDiv.appendChild(actionsContainer);
            fieldsContainer.appendChild(fieldDiv);
        });
        
        groupDiv.appendChild(fieldsContainer);
        container.appendChild(groupDiv);
    });
    
    notifySizeChange();
    
    // Set up batch mapping button
    const mapSelectedBtn = document.getElementById('mapSelectedBtn');
    if (mapSelectedBtn) {
        mapSelectedBtn.addEventListener('click', () => {
            const selectedFields = Array.from(document.querySelectorAll('.batch-select-checkbox:checked'))
                .map(cb => cb.dataset.fieldName)
                .filter(field => !currentMappings.hasOwnProperty(field));
            
            if (selectedFields.length === 0) {
                showStatus(ui, 'Please select at least one unmapped field', 'error');
                return;
            }
            
            const quickMode = document.getElementById('quickMappingMode')?.checked || false;
            if (quickMode) {
                startQuickMappingSequence(ui, selectedFields);
            } else {
                // Map first field, user can manually continue
                startMapping(ui, selectedFields[0]);
                showStatus(ui, `Mapping "${getFieldLabel(selectedFields[0])}". ${selectedFields.length - 1} more field(s) selected.`, 'info');
            }
        });
    }
    
    // Update map selected button visibility
    function updateMapSelectedButton() {
        const selectedCount = document.querySelectorAll('.batch-select-checkbox:checked').length;
        if (mapSelectedBtn) {
            mapSelectedBtn.textContent = `🗺️ Map ${selectedCount} Selected Field${selectedCount !== 1 ? 's' : ''}`;
            mapSelectedBtn.style.display = selectedCount > 0 ? 'inline-block' : 'none';
        }
    }
    
    // Listen for checkbox changes
    document.querySelectorAll('.batch-select-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const fieldDiv = cb.closest('.mapping-field-item');
            if (fieldDiv) {
                fieldDiv.style.background = cb.checked ? '#e6f7ff' : '#fff';
            }
            updateMapSelectedButton();
        });
    });
}

// Start mapping process
function startMapping(ui, fieldName) {
    const domain = ui.mappingDomain.value.trim();
    const fieldType = ui.mappingType.value;
    
    if (!domain) {
        showStatus(ui, 'Please enter a domain', 'error');
        return;
    }
    
    // Send message to content script to start selection mode
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'startMapping',
                fieldName: fieldName,
                fieldType: fieldType
            });
            
            const fieldLabel = getFieldLabel(fieldName);
            showStatus(ui, `Selection mode activated. Click on the page element to map "${fieldLabel}"`, 'info');
        }
    });
}

// Show mapping confirmation dialog with enhanced editing
function showMappingConfirmation(ui, mappingData) {
    console.log('POPUP: showMappingConfirmation called with:', mappingData);
    
    // Validate that we have required data
    if (!mappingData.fieldName) {
        console.error('POPUP: Missing fieldName in mappingData:', mappingData);
        showStatus(ui, 'Error: Field name not specified. Please try again.', 'error');
        return;
    }
    
    // Update pending mapping
    pendingMapping = mappingData;
    
    // Ensure domain is set if missing
    if (!pendingMapping.domain && ui.mappingDomain) {
        pendingMapping.domain = ui.mappingDomain.value.trim();
    }
    
    // Show English label and technical name
    const fieldLabel = getFieldLabel(mappingData.fieldName);
    if (ui.confirmFieldName) {
        ui.confirmFieldName.innerHTML = `<strong>${fieldLabel}</strong><br><small style="color: #666; font-style: italic;">${mappingData.fieldName}</small>`;
    }
    if (ui.confirmFieldType) {
        ui.confirmFieldType.textContent = mappingData.fieldType === 'capture' ? 'Capture (Read)' : 'Autofill (Write)';
    }
    
    const confirmDomain = document.getElementById('confirmDomain');
    if (confirmDomain) {
        confirmDomain.textContent = mappingData.domain || ui.mappingDomain.value.trim() || '(not specified)';
    }
    
    if (ui.confirmSelector) {
        ui.confirmSelector.textContent = mappingData.selector || '(no selector)';
        ui.confirmSelector.contentEditable = 'false';
        ui.confirmSelector.style.border = '1px solid #ddd';
        ui.confirmSelector.style.background = '#f5f5f5';
    }
    
    const confirmExtractionMethod = document.getElementById('confirmExtractionMethod');
    if (confirmExtractionMethod) {
        confirmExtractionMethod.value = mappingData.extractionMethod || 'textContent';
    }
    
    if (ui.confirmValue) {
        ui.confirmValue.textContent = mappingData.previewValue || '(no value)';
    }
    
    // Hide validation result initially
    const validationResult = document.getElementById('selectorValidationResult');
    if (validationResult) {
        validationResult.style.display = 'none';
        validationResult.innerHTML = '';
    }
    
    // Set up edit button
    const editBtn = document.getElementById('editSelectorBtn');
    if (editBtn) {
        editBtn.onclick = () => {
            if (ui.confirmSelector) {
                ui.confirmSelector.contentEditable = 'true';
                ui.confirmSelector.style.background = '#fff';
                ui.confirmSelector.style.border = '2px solid #0672ff';
                ui.confirmSelector.focus();
                editBtn.textContent = '✓ Done Editing';
                editBtn.onclick = () => {
                    ui.confirmSelector.contentEditable = 'false';
                    ui.confirmSelector.style.background = '#f5f5f5';
                    ui.confirmSelector.style.border = '1px solid #ddd';
                    pendingMapping.selector = ui.confirmSelector.textContent.trim();
                    editBtn.textContent = '✏️ Edit Selector';
                    editBtn.onclick = arguments.callee;
                };
            }
        };
    }
    
    // Set up test button
    const testBtn = document.getElementById('testSelectorBtn');
    if (testBtn) {
        testBtn.onclick = async () => {
            const selector = ui.confirmSelector.textContent.trim();
            const extractionMethod = confirmExtractionMethod ? confirmExtractionMethod.value : 'textContent';
            
            if (!selector) {
                alert('Please enter a selector first');
                return;
            }
            
            testBtn.disabled = true;
            testBtn.textContent = 'Testing...';
            
            const validation = await validateSelector(selector, extractionMethod);
            
            testBtn.disabled = false;
            testBtn.textContent = '✓ Test Selector';
            
            if (validationResult) {
                validationResult.style.display = 'block';
                if (validation.valid) {
                    validationResult.style.background = '#d4edda';
                    validationResult.style.border = '1px solid #c3e6cb';
                    validationResult.style.color = '#155724';
                    validationResult.innerHTML = `✓ Selector works! Found: "${validation.value?.substring(0, 100) || '(empty value)'}"${validation.warning ? `<br>⚠️ ${validation.warning}` : ''}`;
                    
                    // Update preview value
                    if (ui.confirmValue && validation.value) {
                        ui.confirmValue.textContent = validation.value;
                    }
                } else {
                    validationResult.style.background = '#f8d7da';
                    validationResult.style.border = '1px solid #f5c6cb';
                    validationResult.style.color = '#721c24';
                    validationResult.innerHTML = `✗ Selector failed: ${validation.error || 'Unknown error'}`;
                }
            }
        };
    }
    
    // Close button
    const closeBtn = document.getElementById('closeConfirmDialog');
    if (closeBtn) {
        closeBtn.onclick = () => cancelMapping(ui);
    }
    
    // Minimize button
    const minimizeBtn = document.getElementById('minimizeConfirmDialog');
    if (minimizeBtn) {
        minimizeBtn.onclick = () => minimizeMappingDialog(ui);
    }
    
    // Hide restore button when showing dialog
    const restoreBtn = document.getElementById('restoreMappingDialogBtn');
    if (restoreBtn) {
        restoreBtn.style.display = 'none';
    }
    
    if (ui.mappingConfirmDialog) {
        ui.mappingConfirmDialog.style.display = 'block';
        notifySizeChange();
    }
}

// Validate selector before saving
async function validateSelector(selector, extractionMethod) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) {
            return { valid: false, error: 'No active tab found' };
        }
        
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (selectorPath, extractionMethod) => {
                try {
                    const element = document.querySelector(selectorPath);
                    if (!element) {
                        // Check if selector is valid CSS
                        try {
                            document.querySelector(selectorPath);
                        } catch (e) {
                            return { valid: false, error: 'Invalid CSS selector syntax' };
                        }
                        return { valid: false, error: 'Element not found on page' };
                    }
                    
                    // Try to extract value
                    let value = '';
                    try {
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
                    } catch (e) {
                        return { valid: false, error: `Cannot extract value: ${e.message}` };
                    }
                    
                    // Check if multiple elements match
                    const matches = document.querySelectorAll(selectorPath);
                    if (matches.length > 1) {
                        return { valid: true, warning: `Warning: Selector matches ${matches.length} elements (using first one)`, value: value };
                    }
                    
                    return { valid: true, value: value, tagName: element.tagName };
                } catch (e) {
                    return { valid: false, error: e.message };
                }
            },
            args: [selector, extractionMethod]
        });
        
        return injectionResults[0]?.result || { valid: false, error: 'Unknown error' };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

// Confirm and save mapping with validation
async function confirmMapping(ui) {
    if (!pendingMapping) {
        showStatus(ui, 'Error: No mapping data to save', 'error');
        return;
    }
    
    // Validate required fields
    if (!pendingMapping.fieldName) {
        showStatus(ui, 'Error: Field name is required', 'error');
        return;
    }
    
    if (!pendingMapping.domain) {
        showStatus(ui, 'Error: Domain is required', 'error');
        return;
    }
    
    // Get selector from editable element
    const selectorElement = ui.confirmSelector;
    if (selectorElement) {
        pendingMapping.selector = selectorElement.textContent.trim();
    }
    
    // Get extraction method from select element
    const extractionMethodSelect = document.getElementById('confirmExtractionMethod');
    if (extractionMethodSelect) {
        pendingMapping.extractionMethod = extractionMethodSelect.value;
    }
    
    if (!pendingMapping.selector) {
        showStatus(ui, 'Error: Selector is required', 'error');
        return;
    }
    
    // Optional: Validate selector before saving (user can skip)
    // Validation is now done via Test button, so we just proceed
    
    const apiKey = ui.apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus(ui, 'Please enter your API Key', 'error');
        return;
    }
    const serviceType = ui.mainServiceType.value;
    
    const payload = {
        domain: pendingMapping.domain,
        field_name: pendingMapping.fieldName,
        field_type: pendingMapping.fieldType || 'capture', // Default to 'capture' if not specified
        service_type: serviceType,
        selector_path: pendingMapping.selector,
        selector_type: pendingMapping.selectorType || 'text',
        extraction_method: pendingMapping.extractionMethod || 'textContent'
    };
    
    console.log('POPUP: Saving mapping with payload:', JSON.stringify(payload, null, 2));
    
    try {
        const data = await chrome.runtime.sendMessage({
            action: 'saveFieldSelector',
            apiKey: apiKey,
            payload: payload
        });
        
        console.log('POPUP: Save mapping response:', JSON.stringify(data, null, 2));
        
        if (data.status === 'success') {
            showStatus(ui, 'Mapping saved successfully', 'success');
            // Clear pending mapping and stored state
            pendingMapping = null;
            chrome.storage.local.remove(['pendingMappingState', 'mappingDialogVisible']);
            if (ui.mappingConfirmDialog) {
                ui.mappingConfirmDialog.style.display = 'none';
                notifySizeChange();
            }
            // Hide restore button if visible
            const restoreBtn = document.getElementById('restoreMappingDialogBtn');
            if (restoreBtn) {
                restoreBtn.style.display = 'none';
            }
            // Reload mappings
            loadMappings(ui);
            
            // Handle quick mapping mode
            handleQuickMappingNext(ui);
        } else {
            const errorMsg = data.message || 'Error saving mapping';
            showStatus(ui, `Error: ${errorMsg}`, 'error');
            console.error('POPUP: Error saving mapping:', data);
            
            // Show retry option
            if (confirm(`${errorMsg}\n\nWould you like to retry?`)) {
                setTimeout(() => confirmMapping(ui), 500);
            }
        }
    } catch (error) {
        console.error('Error saving mapping:', error);
        const errorMsg = error.message || 'Network error occurred';
        showStatus(ui, `Error: ${errorMsg}`, 'error');
        
        // Show retry option for network errors
        if (error.message && error.message.includes('fetch')) {
            if (confirm(`Network error: ${errorMsg}\n\nWould you like to retry?`)) {
                setTimeout(() => confirmMapping(ui), 1000);
            }
        }
    }
}

// Cancel mapping
// Minimize mapping dialog
function minimizeMappingDialog(ui) {
    if (ui.mappingConfirmDialog) {
        ui.mappingConfirmDialog.style.display = 'none';
        notifySizeChange();
    }
    
    // Show restore button
    const restoreBtn = document.getElementById('restoreMappingDialogBtn');
    if (restoreBtn) {
        restoreBtn.style.display = 'block';
    }
}

// Restore mapping dialog
function restoreMappingDialog(ui) {
    if (ui.mappingConfirmDialog && pendingMapping) {
        ui.mappingConfirmDialog.style.display = 'block';
        notifySizeChange();
    }
    
    // Hide restore button
    const restoreBtn = document.getElementById('restoreMappingDialogBtn');
    if (restoreBtn) {
        restoreBtn.style.display = 'none';
    }
}

function cancelMapping(ui) {
    pendingMapping = null;
    if (ui.mappingConfirmDialog) {
        ui.mappingConfirmDialog.style.display = 'none';
        notifySizeChange();
    }
    
    // Hide restore button if visible
    const restoreBtn = document.getElementById('restoreMappingDialogBtn');
    if (restoreBtn) {
        restoreBtn.style.display = 'none';
    }
    
    // Clear any stored pending mapping state
    chrome.storage.local.remove(['pendingMappingState', 'mappingDialogVisible']);
    
    // Cancel selection mode in content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelMapping' });
        }
    });
}

// View/Edit existing mapping
function viewEditMapping(ui, fieldName, mappingData) {
    // Show confirmation dialog with existing mapping data, allow editing
    pendingMapping = {
        fieldName: fieldName,
        fieldType: ui.mappingType.value, // Use current mapping type
        domain: ui.mappingDomain.value.trim(),
        selector: mappingData.selector_path,
        selectorType: mappingData.selector_type || 'text',
        extractionMethod: mappingData.extraction_method || 'textContent',
        previewValue: '(existing mapping - click Test to verify)'
    };
    
    showMappingConfirmation(ui, pendingMapping);
    
    // Make selector editable
    const selectorElement = ui.confirmSelector;
    if (selectorElement) {
        selectorElement.contentEditable = true;
        selectorElement.style.background = '#fff';
        selectorElement.style.border = '1px solid #ccc';
        selectorElement.style.minHeight = '40px';
    }
}

// Test selector on current page
async function testSelector(ui, fieldName, mappingData) {
    const domain = ui.mappingDomain.value.trim();
    const apiKey = ui.apiKeyInput.value.trim();
    
    if (!domain) {
        showStatus(ui, 'Please enter a domain', 'error');
        return;
    }
    
    showStatus(ui, 'Testing selector...', 'info');
    
    try {
        // Get current page HTML
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) {
            throw new Error("No active tab found");
        }
        
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (selectorPath, extractionMethod) => {
                try {
                    const element = document.querySelector(selectorPath);
                    if (!element) {
                        return { success: false, error: 'Element not found', value: null };
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
            showStatus(ui, `✓ Selector works! Found value: "${result.value.substring(0, 50)}${result.value.length > 50 ? '...' : ''}"`, 'success');
        } else {
            showStatus(ui, `✗ Selector failed: ${result?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Error testing selector:', error);
        showStatus(ui, `Error testing selector: ${error.message}`, 'error');
    }
}

// Delete mapping
async function deleteMapping(ui, fieldName) {
    const domain = ui.mappingDomain.value.trim();
    const apiKey = ui.apiKeyInput.value.trim();
    
    if (!domain) {
        showStatus(ui, 'Please enter a domain', 'error');
        return;
    }
    
    if (!apiKey) {
        showStatus(ui, 'Please enter your API Key', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete the mapping for "${getFieldLabel(fieldName)}"?`)) {
        return;
    }
    
    try {
        const fieldType = ui.mappingType.value;
        
        const data = await chrome.runtime.sendMessage({
            action: 'deleteFieldSelector',
            apiKey: apiKey,
            domain: domain,
            fieldName: fieldName,
            fieldType: fieldType
        });
        
        if (data.status === 'success') {
            showStatus(ui, 'Mapping deleted successfully', 'success');
            // Reload mappings
            loadMappings(ui);
        } else {
            // Fallback: Remove from local cache
            delete currentMappings[fieldName];
            renderMappingFields(ui);
            showStatus(ui, data.message || 'Mapping removed from local cache', 'info');
        }
    } catch (error) {
        console.error('Error deleting mapping:', error);
        // Fallback: Remove from local cache
        delete currentMappings[fieldName];
        renderMappingFields(ui);
        showStatus(ui, 'Mapping removed from local cache', 'info');
    }
}

// Quick mapping mode support
let quickMappingQueue = [];
let isQuickMappingMode = false;

function startQuickMappingSequence(ui, fieldsToMap) {
    if (fieldsToMap.length === 0) return;
    
    quickMappingQueue = fieldsToMap;
    isQuickMappingMode = true;
    startMapping(ui, quickMappingQueue[0]);
}

// Check if quick mapping mode is enabled and handle next field
function handleQuickMappingNext(ui) {
    const quickModeCheckbox = document.getElementById('quickMappingMode');
    if (quickModeCheckbox && quickModeCheckbox.checked && quickMappingQueue.length > 0) {
        quickMappingQueue.shift(); // Remove current field
        if (quickMappingQueue.length > 0) {
            // Automatically start mapping next field
            setTimeout(() => {
                startMapping(ui, quickMappingQueue[0]);
                showStatus(ui, `Mapping "${getFieldLabel(quickMappingQueue[0])}". Click on the element.`, 'info');
            }, 500);
        } else {
            isQuickMappingMode = false;
            showStatus(ui, 'Quick mapping sequence completed!', 'success');
        }
    }
}