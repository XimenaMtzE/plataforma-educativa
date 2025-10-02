async function apiFetch(url, method = 'GET', body = null, isFormData = false) {
  const options = { method, credentials: 'include' };
  if (body) {
    if (isFormData) {
      options.body = body;
    } else {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
  }
  try {
    const res = await fetch(url, options);
    console.log(`Fetch ${method} ${url}: Status ${res.status}`);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.log('No autorizado, redirigiendo a login');
        window.location.href = '/login.html';
        return;
      }
      const errorData = await res.json().catch(() => ({}));
      throw new Error(`Error en API: ${res.status} - ${errorData.error || 'Sin detalles'}`);
    }
    return res.json();
  } catch (e) {
    console.error('Error en fetch:', e);
    throw e;
  }
}

async function loadUser() {
  try {
    const user = await apiFetch('/api/user');
    console.log('Respuesta de /api/user en loadUser:', user);
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) {
      userNameElement.textContent = user.name || 'Usuario';
      console.log('Nombre de usuario actualizado en navbar:', user.name);
    } else {
      console.warn('Elemento #user-name no encontrado en la página');
    }
  } catch (e) {
    console.error('Error cargando usuario:', e);
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) userNameElement.textContent = 'Usuario';
  }
}

async function loadAccount() {
  try {
    const user = await apiFetch('/api/user');
    console.log('Datos recibidos en loadAccount:', user);
    const fields = {
      name: document.getElementById('name'),
      email: document.getElementById('email'),
      phone: document.getElementById('phone'),
      socials: document.getElementById('socials'),
      'profile-pic': document.getElementById('profile-pic')
    };
    if (fields.name) fields.name.textContent = user.name || 'No especificado';
    if (fields.email) fields.email.textContent = user.email || 'No especificado';
    if (fields.phone) fields.phone.textContent = user.phone || 'No especificado';
    if (fields.socials) fields.socials.textContent = user.socials || 'No especificado';
    if (fields['profile-pic'] && user.profile_pic) {
      fields['profile-pic'].src = user.profile_pic;
      fields['profile-pic'].style.display = 'block';
      console.log('Foto de perfil cargada:', user.profile_pic);
    } else {
      console.log('No hay foto de perfil disponible');
    }
  } catch (e) {
    console.error('Error cargando datos de cuenta:', e);
    alert('Error al cargar datos de la cuenta');
    const fields = {
      name: document.getElementById('name'),
      email: document.getElementById('email'),
      phone: document.getElementById('phone'),
      socials: document.getElementById('socials')
    };
    if (fields.name) fields.name.textContent = 'Error al cargar';
    if (fields.email) fields.email.textContent = 'Error al cargar';
    if (fields.phone) fields.phone.textContent = 'Error al cargar';
    if (fields.socials) fields.socials.textContent = 'Error al cargar';
  }
}

async function updateProfilePic(event) {
  event.preventDefault();
  const formData = new FormData(document.getElementById('profile-pic-form'));
  const name = document.getElementById('name')?.textContent || '';
  const email = document.getElementById('email')?.textContent || '';
  const phone = document.getElementById('phone')?.textContent || '';
  const socials = document.getElementById('socials')?.textContent || '';
  formData.append('name', name);
  formData.append('email', email);
  formData.append('phone', phone);
  formData.append('socials', socials);
  console.log('Datos enviados en updateProfilePic:', { name, email, phone, socials, profile_pic: formData.get('profile_pic') });
  try {
    const res = await fetch('/api/user/update', { method: 'POST', body: formData });
    const data = await res.json();
    console.log('Respuesta de /api/user/update:', data);
    if (res.ok && data.success) {
      alert('Foto de perfil actualizada correctamente');
      await loadAccount();
      await loadUser();
      window.dispatchEvent(new Event('userUpdated'));
    } else {
      alert('Error al subir la foto: ' + (data.error || 'Intenta de nuevo'));
    }
  } catch (e) {
    console.error('Error en updateProfilePic:', e);
    alert('Error de conexión: ' + e.message);
  }
}

window.addEventListener('userUpdated', () => {
  console.log('Evento userUpdated disparado, recargando usuario');
  loadUser();
});

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('user-name')) {
    loadUser();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('profile-pic-form');
  if (form) {
    form.addEventListener('submit', updateProfilePic);
  }
});

async function loadTasks() {
  const tasks = await apiFetch('/api/tasks');
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  if (!tasks || tasks.length === 0) {
    list.innerHTML = `
      <div class="empty-tasks text-center">
        <i class="bi bi-check-square"></i>
        <h3>No hay tareas aún</h3>
        <p>¡Comienza agregando una nueva tarea!</p>
      </div>
    `;
    return;
  }
  tasks.forEach(task => {
    const div = document.createElement('div');
    div.className = 'card mb-3';
    div.innerHTML = `
      <div class="d-flex align-items-center">
        <input type="checkbox" class="me-2" ${task.completed ? 'checked' : ''} onclick="toggleTask(${task.id}, this.checked)">
        <div>
          <h5>${escapeHtml(task.title)}</h5>
          <p>Categoría: ${escapeHtml(task.category)}</p>
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-primary btn-sm" onclick="editTask(${task.id})">
          <i class="bi bi-pencil"></i> Editar
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask(${task.id})">
          <i class="bi bi-trash"></i> Eliminar
        </button>
      </div>
    `;
    list.appendChild(div);
  });
}

async function addTask() {
  const title = document.getElementById('task-title').value;
  const category = document.getElementById('task-category').value;
  await apiFetch('/api/tasks', 'POST', { title, category });
  loadTasks();
}

async function toggleTask(id, completed) {
  await apiFetch(`/api/tasks/${id}`, 'PUT', { completed: completed ? 1 : 0 });
}

async function editTask(id) {
  const title = prompt('Nuevo título');
  const category = prompt('Nueva categoría');
  await apiFetch(`/api/tasks/${id}`, 'PUT', { title, category });
  loadTasks();
}

async function deleteTask(id) {
  await apiFetch(`/api/tasks/${id}`, 'DELETE');
  loadTasks();
}

async function loadFiles() {
  const files = await apiFetch('/api/files');
  const gallery = document.getElementById('file-gallery');
  gallery.innerHTML = '';
  if (!files || files.length === 0) {
    gallery.innerHTML = `
      <div class="empty-files text-center">
        <i class="bi bi-folder"></i>
        <h3>No hay archivos aún</h3>
        <p>¡Comienza subiendo un nuevo archivo!</p>
      </div>
    `;
    return;
  }
  files.forEach(file => {
    let elem;
    if (file.category === 'photos') {
      elem = `<img src="${file.filename}" class="thumbnail" alt="Photo">`;
    } else if (file.category === 'videos') {
      elem = `<video src="${file.filename}" class="thumbnail" controls></video>`;
    } else if (file.category === 'audios') {
      elem = `<audio src="${file.filename}" class="thumbnail" controls></audio>`;
    } else {
      elem = `<a href="${file.filename}" class="thumbnail">Descargar ${file.filename}</a>`;
    }
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      ${elem}
      <p>Categoría: ${escapeHtml(file.category)}</p>
      <div class="file-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteFile(${file.id})">
          <i class="bi bi-trash"></i> Eliminar
        </button>
      </div>
    `;
    gallery.appendChild(div);
  });
}

async function uploadFile() {
  const formData = new FormData(document.getElementById('file-form'));
  await fetch('/api/files', { method: 'POST', body: formData });
  loadFiles();
}

async function deleteFile(id) {
  await apiFetch(`/api/files/${id}`, 'DELETE');
  loadFiles();
}

async function loadResources() {
  try {
    const resources = await apiFetch('/api/resources');
    console.log('Recursos obtenidos:', resources);
    const list = document.getElementById('resource-list');
    if (!list) {
      console.error('Elemento #resource-list no encontrado');
      return;
    }
    list.innerHTML = '';
    if (!resources || resources.length === 0) {
      list.innerHTML = `
        <div class="empty-resources">
          <i class="bi bi-link"></i>
          <h3>No hay recursos aún</h3>
          <p>¡Comienza agregando un nuevo recurso!</p>
        </div>
      `;
      return;
    }
    resources.forEach(res => {
      const videoIdMatch = res.link && typeof res.link === 'string' ? res.link.match(/(?:v=|youtu\.be\/)([^&?]+)/) : null;
      const thumbnail = res.image || (videoIdMatch ? `https://img.youtube.com/vi/${videoIdMatch[1]}/0.jpg` : '');
      console.log('Renderizando recurso:', { id: res.id, title: res.title, link: res.link, image: res.image, thumbnail });
      const div = document.createElement('div');
      div.className = 'resource-item mb-3';
      div.innerHTML = `
        ${thumbnail ? `<img src="${thumbnail}" class="thumbnail" alt="${escapeHtml(res.title || 'Recurso sin título')}">` : ''}
        <h5>${escapeHtml(res.title || 'Sin título')}</h5>
        <a href="${res.link || '#'}" target="_blank">${escapeHtml(res.link || 'Sin enlace')}</a>
        <div class="resource-actions mt-2">
          <button class="btn btn-primary btn-sm me-2" onclick="editResource(${res.id})">Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteResource(${res.id})">Eliminar</button>
        </div>
      `;
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error cargando recursos:', e);
    const list = document.getElementById('resource-list');
    if (list) {
      list.innerHTML = `
        <div class="empty-resources">
          <i class="bi bi-exclamation-triangle"></i>
          <h3>Error al cargar recursos</h3>
          <p>Intenta recargar la página</p>
        </div>
      `;
    }
  }
}

async function addResource() {
  const form = document.getElementById('resource-form');
  const title = form.querySelector('#res-title').value.trim();
  const link = form.querySelector('#res-link').value.trim();
  const image = form.querySelector('#res-image').files[0];
  
  if (!title || !link) {
    showNotification('El título y el enlace son obligatorios', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('link', link);
  if (image) formData.append('image', image);

  console.log('Datos enviados en addResource:', {
    title,
    link,
    image: image ? 'Imagen seleccionada' : 'Sin imagen'
  });
  try {
    const response = await fetch('/api/resources', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    console.log('Respuesta de /api/resources:', data);
    if (response.ok && data.success) {
      form.reset();
      await loadResources();
      showNotification('Recurso añadido correctamente', 'success');
    } else {
      throw new Error(data.error || 'Error al añadir recurso');
    }
  } catch (e) {
    console.error('Error en addResource:', e);
    showNotification('Error al añadir el recurso: ' + e.message, 'error');
  }
}

async function getResource(id) {
  try {
    const resource = await apiFetch(`/api/resources/${id}`);
    console.log('Recurso obtenido para edición:', resource);
    return resource;
  } catch (e) {
    console.error('Error obteniendo recurso:', e);
    showNotification('Error al cargar el recurso: ' + e.message, 'error');
    return null;
  }
}

async function editResource(id) {
  try {
    const resource = await getResource(id);
    if (!resource) return;
    const title = prompt('Nuevo título', resource.title || '');
    const link = prompt('Nuevo enlace', resource.link || '');
    if (title && link) {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('link', link);
      console.log('Datos enviados en editResource:', { title, link });
      const response = await fetch(`/api/resources/${id}`, {
        method: 'PUT',
        body: formData
      });
      const data = await response.json();
      console.log('Respuesta de /api/resources/:id:', data);
      if (response.ok && data.success) {
        await loadResources();
        showNotification('Recurso actualizado correctamente', 'success');
      } else {
        throw new Error(data.error || 'Error al actualizar recurso');
      }
    }
  } catch (e) {
    console.error('Error en editResource:', e);
    showNotification('Error al editar el recurso: ' + e.message, 'error');
  }
}

async function deleteResource(id) {
  if (confirm('¿Estás seguro de que quieres eliminar este recurso?')) {
    try {
      const response = await apiFetch(`/api/resources/${id}`, 'DELETE');
      console.log('Respuesta de DELETE /api/resources/:id:', response);
      await loadResources();
      showNotification('Recurso eliminado correctamente', 'success');
    } catch (e) {
      console.error('Error en deleteResource:', e);
      showNotification('Error al eliminar el recurso: ' + e.message, 'error');
    }
  }
}

async function loadNotes() {
  try {
    const notes = await apiFetch('/api/notes');
    console.log('Notas obtenidas:', notes);
    const list = document.getElementById('note-list');
    if (!list) {
      console.error('Elemento #note-list no encontrado');
      return;
    }
    list.innerHTML = '';
    if (!notes || notes.length === 0) {
      list.innerHTML = `
        <div class="empty-notes">
          <i class="bi bi-pencil"></i>
          <h3>No hay notas aún</h3>
          <p>¡Comienza agregando una nueva nota!</p>
        </div>
      `;
      return;
    }
    notes.forEach(note => {
      const div = document.createElement('div');
      div.className = 'note-item mb-3';
      div.innerHTML = `
        <textarea class="form-control" rows="4">${escapeHtml(note.content)}</textarea>
        <div class="note-actions">
          <button class="btn btn-primary btn-sm" onclick="editNote(${note.id}, this.parentElement.previousElementSibling.value)">
            <i class="bi bi-save"></i> Guardar
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteNote(${note.id})">
            <i class="bi bi-trash"></i> Eliminar
          </button>
        </div>
      `;
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error cargando notas:', e);
    const list = document.getElementById('note-list');
    if (list) {
      list.innerHTML = `
        <div class="empty-notes">
          <i class="bi bi-exclamation-triangle"></i>
          <h3>Error al cargar notas</h3>
          <p>Intenta recargar la página</p>
        </div>
      `;
    }
  }
}

async function addNote() {
  const content = document.getElementById('note-content').value.trim();
  if (!content) {
    showNotification('La nota no puede estar vacía', 'error');
    return;
  }
  try {
    await apiFetch('/api/notes', 'POST', { content });
    document.getElementById('note-content').value = '';
    await loadNotes();
    showNotification('Nota añadida correctamente', 'success');
  } catch (e) {
    console.error('Error en addNote:', e);
    showNotification('Error al añadir la nota: ' + e.message, 'error');
  }
}

async function editNote(id, content) {
  try {
    await apiFetch(`/api/notes/${id}`, 'PUT', { content });
    showNotification('Nota actualizada correctamente', 'success');
  } catch (e) {
    console.error('Error en editNote:', e);
    showNotification('Error al actualizar la nota: ' + e.message, 'error');
  }
}

async function deleteNote(id) {
  if (confirm('¿Estás seguro de que quieres eliminar esta nota?')) {
    try {
      await apiFetch(`/api/notes/${id}`, 'DELETE');
      await loadNotes();
      showNotification('Nota eliminada correctamente', 'success');
    } catch (e) {
      console.error('Error en deleteNote:', e);
      showNotification('Error al eliminar la nota: ' + e.message, 'error');
    }
  }
}

function logout() {
  fetch('/api/logout').then(() => window.location.href = '/');
}

function showNotification(message, type) {
  console.log(`Notificación: ${message} (${type})`);
  alert(message);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}