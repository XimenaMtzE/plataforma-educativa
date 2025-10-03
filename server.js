const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

// Configurar entorno para producción o desarrollo
const isProduction = process.env.NODE_ENV === 'production';
const uploadsPath = isProduction ? '/app/data/uploads/' : 'uploads/';

// Crear carpeta para uploads
const ensureDirectoryExists = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o777 });
      console.log(`Carpeta creada: ${dirPath}`);
    } else {
      fs.chmodSync(dirPath, 0o777);
      console.log(`Permisos actualizados para: ${dirPath}`);
    }
  } catch (err) {
    console.error(`Error creando/actualizando carpeta ${dirPath}:`, err);
    throw err;
  }
};

if (isProduction) {
  ensureDirectoryExists('/app/data');
}
ensureDirectoryExists(uploadsPath);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsPath));
if (isProduction) {
  app.set('trust proxy', 1); // Para HTTPS en Railway
}

// Configurar conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Configurar sesiones con PostgreSQL
try {
  app.use(session({
    store: new pgSession({
      pool: pool,
      tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'secret-key-local',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
  }));
  console.log('Almacén de sesiones PostgreSQL inicializado correctamente');
} catch (err) {
  console.error('Error al inicializar el almacén de sesiones:', err);
  process.exit(1);
}

// Config Multer para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsPath),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Crear tablas en PostgreSQL
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        register_date DATE DEFAULT CURRENT_DATE,
        profile_pic TEXT,
        phone TEXT,
        socials TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        filename TEXT NOT NULL,
        category TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        image TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        content TEXT NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS topics (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        subtopic TEXT NOT NULL,
        explanation TEXT NOT NULL,
        image TEXT,
        link TEXT
      )
    `);

    // Verificar si la columna 'image' existe en resources
    const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'resources' AND column_name = 'image'");
    if (rows.length === 0) {
      await pool.query("ALTER TABLE resources ADD COLUMN image TEXT");
      console.log("Columna 'image' añadida a la tabla resources");
    }

    console.log('Tablas creadas o verificadas correctamente');
  } catch (err) {
    console.error('Error al crear tablas:', err);
    process.exit(1);
  }
}

// Inicializar la base de datos al arrancar
initializeDatabase();

// Healthcheck para Railway
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Error en /health:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Middleware para verificar autenticación
function isAuthenticated(req, res, next) {
  console.log('Sesión:', req.session);
  if (req.session.userId) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// Middleware de manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error no capturado:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Rutas Frontend
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
app.get('/home.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/home.html')));
app.get('/account.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/account.html')));
app.get('/tasks.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/tasks.html')));
app.get('/files.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/files.html')));
app.get('/resources.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/resources.html')));
app.get('/notes.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/notes.html')));
app.get('/topics.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/topics.html')));
app.get('/tutorial.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname, 'public/tutorial.html')));

// API: Register
app.post('/api/register', upload.single('profile_pic'), async (req, res) => {
  const { username, name, email, password, phone, socials } = req.body;
  const profile_pic = req.file ? `/uploads/${req.file.filename}` : null;
  console.log('Datos recibidos en /api/register:', { username, name, email, password, phone, socials, profile_pic });
  if (!username || !name || !email || !password) {
    console.error('Faltan campos obligatorios:', { username, name, email, password });
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, name, email, password, phone, socials, profile_pic) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [username, name, email, hashed, phone || null, socials || null, profile_pic]
    );
    console.log('Usuario registrado:', { id: rows[0].id, username, name, email, phone, socials, profile_pic });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/register:', err);
    res.status(500).json({ error: 'Error en el servidor al registrar usuario' });
  }
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    console.error('Faltan username o password en /api/login:', req.body);
    return res.status(400).json({ error: 'Faltan username o password' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user) {
      console.error('Usuario no encontrado:', username);
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.error('Contraseña incorrecta para:', username);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    req.session.userId = user.id;
    console.log('Sesión creada para userId:', user.id);
    res.json({ success: true, redirect: '/home.html' });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// API: Logout
app.get('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error al destruir sesión:', err);
      return res.status(500).json({ error: 'Error al cerrar sesión' });
    }
    res.redirect('/');
  });
});

// API: Get User Info
app.get('/api/user', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
    const user = rows[0];
    if (!user) {
      console.error('Usuario no encontrado para id:', req.session.userId);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (err) {
    console.error('Error en /api/user:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Update User
app.post('/api/user/update', isAuthenticated, upload.single('profile_pic'), async (req, res) => {
  const { name, email, phone, socials } = req.body;
  const profile_pic = req.file ? `/uploads/${req.file.filename}` : req.body.profile_pic || null;
  try {
    let query = 'UPDATE users SET name = $1, email = $2, phone = $3, socials = $4';
    let params = [name || null, email || null, phone || null, socials || null];
    if (profile_pic) {
      query += ', profile_pic = $5';
      params.push(profile_pic);
    }
    query += ' WHERE id = $' + (params.length + 1);
    params.push(req.session.userId);
    await pool.query(query, params);
    console.log('Usuario actualizado:', { id: req.session.userId, name, email, phone, socials, profile_pic });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/user/update:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Tasks
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE user_id = $1', [req.session.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/tasks:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/api/tasks', isAuthenticated, async (req, res) => {
  const { title, category } = req.body;
  if (!title || !category) {
    console.error('Faltan campos en /api/tasks:', req.body);
    return res.status(400).json({ error: 'Faltan title o category' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO tasks (user_id, title, category) VALUES ($1, $2, $3) RETURNING id',
      [req.session.userId, title, category]
    );
    console.log('Tarea creada:', { id: rows[0].id, user_id: req.session.userId, title, category });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/tasks:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/api/tasks/:id', isAuthenticated, async (req, res) => {
  const { title, category, completed } = req.body;
  if (!title || !category || completed === undefined) {
    console.error('Faltan campos en /api/tasks/:id:', req.body);
    return res.status(400).json({ error: 'Faltan title, category o completed' });
  }
  try {
    await pool.query(
      'UPDATE tasks SET title = $1, category = $2, completed = $3 WHERE id = $4 AND user_id = $5',
      [title, category, completed, req.params.id, req.session.userId]
    );
    console.log('Tarea actualizada:', { id: req.params.id, user_id: req.session.userId, title, category, completed });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/tasks/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.delete('/api/tasks/:id', isAuthenticated, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    console.log('Tarea eliminada:', { id: req.params.id, user_id: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/tasks/:id (delete):', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Files
app.get('/api/files', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM files WHERE user_id = $1', [req.session.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/files:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/api/files', isAuthenticated, upload.single('file'), async (req, res) => {
  const { category } = req.body;
  if (!req.file || !category) {
    console.error('Faltan archivo o category en /api/files:', req.body, req.file);
    return res.status(400).json({ error: 'Faltan archivo o category' });
  }
  try {
    const filename = `/uploads/${req.file.filename}`;
    const { rows } = await pool.query(
      'INSERT INTO files (user_id, filename, category) VALUES ($1, $2, $3) RETURNING id',
      [req.session.userId, filename, category]
    );
    console.log('Archivo subido:', { id: rows[0].id, user_id: req.session.userId, filename, category });
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Error en /api/files:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.delete('/api/files/:id', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT filename FROM files WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    const file = rows[0];
    if (file) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + file.filename : file.filename);
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error eliminando archivo:', err);
      });
    }
    await pool.query('DELETE FROM files WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    console.log('Archivo eliminado:', { id: req.params.id, user_id: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/files/:id (delete):', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Resources
app.get('/api/resources', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources WHERE user_id = $1', [req.session.userId]);
    console.log('Recursos enviados:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/resources:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.get('/api/resources/:id', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    const row = rows[0];
    if (!row) {
      console.error('Recurso no encontrado:', req.params.id);
      return res.status(404).json({ error: 'Recurso no encontrado' });
    }
    res.json(row);
  } catch (err) {
    console.error('Error en /api/resources/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/api/resources', isAuthenticated, upload.single('image'), async (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  console.log('Datos recibidos en POST /api/resources:', { user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO resources (user_id, title, link, image) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.session.userId, title, link, image]
    );
    console.log('Recurso insertado:', { id: rows[0].id, user_id: req.session.userId, title, link, image });
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('Error en /api/resources:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/api/resources/:id', isAuthenticated, upload.single('image'), async (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  console.log('Datos recibidos en PUT /api/resources/:id:', { id: req.params.id, user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  try {
    let query = 'UPDATE resources SET title = $1, link = $2';
    let params = [title, link];
    if (image) {
      query += ', image = $3';
      params.push(image);
    }
    query += ' WHERE id = $' + (params.length + 1) + ' AND user_id = $' + (params.length + 2);
    params.push(req.params.id, req.session.userId);
    await pool.query(query, params);
    console.log('Recurso actualizado:', { id: req.params.id, user_id: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/resources/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.delete('/api/resources/:id', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT image FROM resources WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    const resource = rows[0];
    if (resource && resource.image) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + resource.image : resource.image);
      fs.unlink(filePath, err => {
        if (err) console.error('Error eliminando imagen:', err);
      });
    }
    await pool.query('DELETE FROM resources WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    console.log('Recurso eliminado:', { id: req.params.id, user_id: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/resources/:id (delete):', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Notes
app.get('/api/notes', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM notes WHERE user_id = $1', [req.session.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/notes:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/api/notes', isAuthenticated, async (req, res) => {
  const { content } = req.body;
  if (!content) {
    console.error('Falta content en /api/notes:', req.body);
    return res.status(400).json({ error: 'Falta content' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO notes (user_id, content) VALUES ($1, $2) RETURNING id',
      [req.session.userId, content]
    );
    console.log('Nota creada:', { id: rows[0].id, user_id: req.session.userId, content });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/notes:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/api/notes/:id', isAuthenticated, async (req, res) => {
  const { content } = req.body;
  if (!content) {
    console.error('Falta content en /api/notes/:id:', req.body);
    return res.status(400).json({ error: 'Falta content' });
  }
  try {
    await pool.query(
      'UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3',
      [content, req.params.id, req.session.userId]
    );
    console.log('Nota actualizada:', { id: req.params.id, user_id: req.session.userId, content });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/notes/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.delete('/api/notes/:id', isAuthenticated, async (req, res) => {
  try {
    await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    console.log('Nota eliminada:', { id: req.params.id, user_id: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/notes/:id (delete):', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Topics
app.get('/api/topics', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM topics');
    console.log('Temas enviados:', rows);
    res.json(rows);
  } catch (err) {
    console.error('Error en /api/topics:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.get('/api/topics/:id', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM topics WHERE id = $1', [req.params.id]);
    const row = rows[0];
    if (!row) {
      console.error('Tema no encontrado:', req.params.id);
      return res.status(404).json({ error: 'Tema no encontrado' });
    }
    res.json(row);
  } catch (err) {
    console.error('Error en /api/topics/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/api/topics', isAuthenticated, upload.single('image'), async (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  if (!subject || !subtopic || !explanation) {
    console.error('Faltan campos obligatorios en /api/topics:', req.body);
    return res.status(400).json({ error: 'Faltan subject, subtopic o explanation' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO topics (subject, subtopic, explanation, image, link) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [subject, subtopic, explanation, image, link]
    );
    console.log('Tema creado:', { id: rows[0].id, subject, subtopic, explanation, image, link });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/topics:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/api/topics/:id', isAuthenticated, upload.single('image'), async (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  if (!subject || !subtopic || !explanation) {
    console.error('Faltan campos obligatorios en /api/topics/:id:', req.body);
    return res.status(400).json({ error: 'Faltan subject, subtopic o explanation' });
  }
  try {
    let query = 'UPDATE topics SET subject = $1, subtopic = $2, explanation = $3, link = $4';
    let params = [subject, subtopic, explanation, link];
    if (image) {
      query += ', image = $5';
      params.push(image);
    }
    query += ' WHERE id = $' + (params.length + 1);
    params.push(req.params.id);
    await pool.query(query, params);
    console.log('Tema actualizado:', { id: req.params.id, subject, subtopic, explanation, image, link });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/topics/:id:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.delete('/api/topics/:id', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT image FROM topics WHERE id = $1', [req.params.id]);
    const topic = rows[0];
    if (topic && topic.image) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + topic.image : topic.image);
      fs.unlink(filePath, err => {
        if (err) console.error('Error eliminando imagen:', err);
      });
    }
    await pool.query('DELETE FROM topics WHERE id = $1', [req.params.id]);
    console.log('Tema eliminado:', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en /api/topics/:id (delete):', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// Cerrar conexión a PostgreSQL al apagar el servidor
process.on('SIGTERM', async () => {
  console.log('Cerrando servidor y conexión a PostgreSQL');
  await pool.end();
  process.exit(0);
});

// Escuchar en 0.0.0.0 para Railway
app.listen(port, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${port}`));