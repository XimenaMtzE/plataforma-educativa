const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

// Configurar entorno para producción o desarrollo
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction ? '/app/data/db.sqlite' : 'db.sqlite';
const uploadsPath = isProduction ? '/app/data/uploads/' : 'uploads/';

// Crear carpetas necesarias
const ensureDirectoryExists = (dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Carpeta creada: ${dirPath}`);
    }
  } catch (err) {
    console.error(`Error creando carpeta ${dirPath}:`, err);
  }
};

// Crear carpetas para SQLite y uploads
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
  app.set('trust proxy', 1); // Para HTTPS en Render
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-key-local',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Config Multer para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsPath),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// DB Setup con better-sqlite3
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Modo de escritura seguro

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT,
  register_date DATE,
  profile_pic TEXT,
  phone TEXT,
  socials TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT,
  category TEXT,
  completed BOOLEAN DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  filename TEXT,
  category TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  image TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  content TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT,
  subtopic TEXT,
  explanation TEXT,
  image TEXT,
  link TEXT
)`);

// Verificar si la columna 'image' existe en resources, y añadirla si no
const resourceTableInfo = db.prepare("PRAGMA table_info(resources)").all();
if (!resourceTableInfo.find(col => col.name === 'image')) {
  db.exec("ALTER TABLE resources ADD COLUMN image TEXT");
  console.log("Columna 'image' añadida a la tabla resources");
}

// Middleware para check login
function isAuthenticated(req, res, next) {
  console.log('Sesión:', req.session);
  if (req.session.userId) return next();
  res.status(401).json({ error: 'No autorizado' });
}

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
    const stmt = db.prepare("INSERT INTO users (username, name, email, password, register_date, phone, socials, profile_pic) VALUES (?, ?, ?, ?, DATE('now'), ?, ?, ?)");
    const result = stmt.run(username, name, email, hashed, phone || null, socials || null, profile_pic);
    console.log('Usuario registrado:', { id: result.lastInsertRowid, username, name, email, phone, socials, profile_pic });
    res.json({ success: true });
  } catch (e) {
    console.error('Error en /api/register (bcrypt):', e);
    res.status(500).json({ error: 'Error en el servidor al hashear la contraseña' });
  }
});

// API: Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
  const user = stmt.get(username);
  bcrypt.compare(password, user.password).then(match => {
    if (!user || !match) {
      return res.status(400).json({ error: 'Credenciales inválidas' });
    }
    req.session.userId = user.id;
    console.log('Sesión creada para userId:', req.session.userId);
    res.json({ success: true, redirect: '/home.html' });
  }).catch(err => {
    console.error('Error en /api/login (bcrypt):', err);
    res.status(500).json({ error: 'Error en servidor' });
  });
});

// API: Logout
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// API: Get User Info
app.get('/api/user', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = stmt.get(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  res.json(user);
});

// API: Update User
app.post('/api/user/update', isAuthenticated, upload.single('profile_pic'), (req, res) => {
  const { name, email, phone, socials } = req.body;
  const profile_pic = req.file ? `/uploads/${req.file.filename}` : req.body.profile_pic || null;
  let query = "UPDATE users SET name = ?, email = ?, phone = ?, socials = ?";
  let params = [name || null, email || null, phone || null, socials || null];
  if (profile_pic) {
    query += ", profile_pic = ?";
    params.push(profile_pic);
  }
  query += " WHERE id = ?";
  params.push(req.session.userId);
  try {
    const stmt = db.prepare(query);
    stmt.run(...params);
    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

// API: Tasks
app.get('/api/tasks', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM tasks WHERE user_id = ?");
  const rows = stmt.all(req.session.userId);
  res.json(rows);
});

app.post('/api/tasks', isAuthenticated, (req, res) => {
  const { title, category } = req.body;
  const stmt = db.prepare("INSERT INTO tasks (user_id, title, category) VALUES (?, ?, ?)");
  const result = stmt.run(req.session.userId, title, category);
  res.json({ success: true });
});

app.put('/api/tasks/:id', isAuthenticated, (req, res) => {
  const { title, category, completed } = req.body;
  const stmt = db.prepare("UPDATE tasks SET title = ?, category = ?, completed = ? WHERE id = ? AND user_id = ?");
  const result = stmt.run(title, category, completed, req.params.id, req.session.userId);
  res.json({ success: true });
});

app.delete('/api/tasks/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?");
  stmt.run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// API: Files
app.get('/api/files', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM files WHERE user_id = ?");
  const rows = stmt.all(req.session.userId);
  res.json(rows);
});

app.post('/api/files', isAuthenticated, upload.single('file'), (req, res) => {
  const { category } = req.body;
  const filename = `/uploads/${req.file.filename}`;
  const stmt = db.prepare("INSERT INTO files (user_id, filename, category) VALUES (?, ?, ?)");
  const result = stmt.run(req.session.userId, filename, category);
  res.json({ success: true, filename });
});

app.delete('/api/files/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT filename FROM files WHERE id = ? AND user_id = ?");
  const file = stmt.get(req.params.id, req.session.userId);
  if (file) {
    const filePath = path.join(__dirname, isProduction ? '/app/data' + file.filename : file.filename);
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error eliminando archivo:', err);
    });
  }
  const deleteStmt = db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?");
  deleteStmt.run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// API: Resources
app.get('/api/resources', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM resources WHERE user_id = ?");
  const rows = stmt.all(req.session.userId);
  console.log('Recursos enviados:', rows);
  res.json(rows);
});

app.get('/api/resources/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM resources WHERE id = ? AND user_id = ?");
  const row = stmt.get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Recurso no encontrado' });
  res.json(row);
});

app.post('/api/resources', isAuthenticated, upload.single('image'), (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  console.log('Datos recibidos en POST /api/resources:', { user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  const stmt = db.prepare("INSERT INTO resources (user_id, title, link, image) VALUES (?, ?, ?, ?)");
  const result = stmt.run(req.session.userId, title, link, image);
  console.log('Recurso insertado:', { id: result.lastInsertRowid, user_id: req.session.userId, title, link, image });
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/resources/:id', isAuthenticated, upload.single('image'), (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  console.log('Datos recibidos en PUT /api/resources/:id:', { id: req.params.id, user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  let query = "UPDATE resources SET title = ?, link = ?";
  let params = [title, link];
  if (image) {
    query += ", image = ?";
    params.push(image);
  }
  query += " WHERE id = ? AND user_id = ?";
  params.push(req.params.id, req.session.userId);
  const stmt = db.prepare(query);
  stmt.run(...params);
  console.log('Recurso actualizado:', { id: req.params.id });
  res.json({ success: true });
});

app.delete('/api/resources/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT image FROM resources WHERE id = ? AND user_id = ?");
  const resource = stmt.get(req.params.id, req.session.userId);
  if (resource && resource.image) {
    const filePath = path.join(__dirname, isProduction ? '/app/data' + resource.image : resource.image);
    fs.unlink(filePath, err => {
      if (err) console.error('Error eliminando imagen:', err);
    });
  }
  const deleteStmt = db.prepare("DELETE FROM resources WHERE id = ? AND user_id = ?");
  deleteStmt.run(req.params.id, req.session.userId);
  console.log('Recurso eliminado:', { id: req.params.id });
  res.json({ success: true });
});

// API: Notes
app.get('/api/notes', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM notes WHERE user_id = ?");
  const rows = stmt.all(req.session.userId);
  res.json(rows);
});

app.post('/api/notes', isAuthenticated, (req, res) => {
  const { content } = req.body;
  const stmt = db.prepare("INSERT INTO notes (user_id, content) VALUES (?, ?)");
  stmt.run(req.session.userId, content);
  res.json({ success: true });
});

app.put('/api/notes/:id', isAuthenticated, (req, res) => {
  const { content } = req.body;
  const stmt = db.prepare("UPDATE notes SET content = ? WHERE id = ? AND user_id = ?");
  stmt.run(content, req.params.id, req.session.userId);
  res.json({ success: true });
});

app.delete('/api/notes/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?");
  stmt.run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// API: Topics
app.get('/api/topics', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM topics");
  const rows = stmt.all();
  console.log('Temas enviados:', rows);
  res.json(rows);
});

app.get('/api/topics/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT * FROM topics WHERE id = ?");
  const row = stmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tema no encontrado' });
  res.json(row);
});

app.post('/api/topics', isAuthenticated, upload.single('image'), (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const stmt = db.prepare("INSERT INTO topics (subject, subtopic, explanation, image, link) VALUES (?, ?, ?, ?, ?)");
  const result = stmt.run(subject, subtopic, explanation, image, link);
  res.json({ success: true });
});

app.put('/api/topics/:id', isAuthenticated, upload.single('image'), (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  let query = "UPDATE topics SET subject = ?, subtopic = ?, explanation = ?, link = ?";
  let params = [subject, subtopic, explanation, link];
  if (image) {
    query += ", image = ?";
    params.push(image);
  }
  query += " WHERE id = ?";
  params.push(req.params.id);
  const stmt = db.prepare(query);
  stmt.run(...params);
  res.json({ success: true });
});

app.delete('/api/topics/:id', isAuthenticated, (req, res) => {
  const stmt = db.prepare("SELECT image FROM topics WHERE id = ?");
  const topic = stmt.get(req.params.id);
  if (topic && topic.image) {
    const filePath = path.join(__dirname, isProduction ? '/app/data' + topic.image : topic.image);
    fs.unlink(filePath, err => {
      if (err) console.error('Error eliminando imagen:', err);
    });
  }
  const deleteStmt = db.prepare("DELETE FROM topics WHERE id = ?");
  deleteStmt.run(req.params.id);
  res.json({ success: true });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));