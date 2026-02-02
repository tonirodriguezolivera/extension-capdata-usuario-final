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

async function fillFormWithSelectedContact(ui) {
    if (!selectedContact) {
        showStatus(ui, 'Error: Ningún contacto seleccionado.', 'error');
        return;
    }
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
                for (const [fieldName, mapping] of Object.entries(mappingsData.mappings)) {
                    if (typeof mapping === 'string') {
                        selectors[fieldName] = mapping;
                    } else if (mapping && mapping.selector_path) {
                        selectors[fieldName] = mapping.selector_path;
                    }
                }
                
                if (Object.keys(selectors).length > 0) {
                    usingMappings = true;
                    console.log('Usando mapeos encontrados:', selectors);
                } else {
                    selectors = null;
                }
            }
        } catch (error) {
            console.warn('Error cargando mapeos:', error);
        }
        
        if (!selectors) {
            throw new Error('No se encontraron mapeos guardados para este dominio. Contacta con soporte.');
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

        showStatus(ui, 'Rellenando formulario...', 'success');

        const responseFromContent = await chrome.tabs.sendMessage(activeTabId, {
            action: 'fillPageData',
            data: dataToFill,
            selectors: selectors 
        });
        
        const report = responseFromContent.report;
        
        if (report.fields_found >= 1) {
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