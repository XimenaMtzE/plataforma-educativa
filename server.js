const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
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

// DB Setup
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
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

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    category TEXT,
    completed BOOLEAN DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    category TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    content TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    subtopic TEXT,
    explanation TEXT,
    image TEXT,
    link TEXT
  )`);

  // Verificar si la columna 'image' existe en resources, y añadirla si no
  db.all("PRAGMA table_info(resources)", (err, columns) => {
    if (err) {
      console.error('Error verificando tabla resources:', err);
      return;
    }
    if (!columns.find(col => col.name === 'image')) {
      db.run("ALTER TABLE resources ADD COLUMN image TEXT", err => {
        if (err) {
          console.error('Error añadiendo columna image:', err);
        } else {
          console.log("Columna 'image' añadida a la tabla resources");
        }
      });
    }
  });
});

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
    db.run(
      "INSERT INTO users (username, name, email, password, register_date, phone, socials, profile_pic) VALUES (?, ?, ?, ?, DATE('now'), ?, ?, ?)",
      [username, name, email, hashed, phone || null, socials || null, profile_pic],
      function(err) {
        if (err) {
          console.error('Error en registro:', err);
          return res.status(400).json({ error: 'Usuario o email ya existe' });
        }
        console.log('Usuario registrado:', { id: this.lastID, username, name, email, phone, socials, profile_pic });
        res.json({ success: true });
      }
    );
  } catch (e) {
    console.error('Error en /api/register (bcrypt):', e);
    res.status(500).json({ error: 'Error en el servidor al hashear la contraseña' });
  }
});

// API: Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (err) {
      console.error('Error en DB:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Credenciales inválidas' });
    req.session.userId = user.id;
    console.log('Sesión creada para userId:', req.session.userId);
    res.json({ success: true, redirect: '/home.html' });
  });
});

// API: Logout
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// API: Get User Info
app.get('/api/user', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM users WHERE id = ?", [req.session.userId], (err, user) => {
    if (err) {
      console.error('Error obteniendo usuario:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    res.json(user);
  });
});

// API: Update User
app.post('/api/user/update', isAuthenticated, upload.single('profile_pic'), (req, res) => {
  const { name, email, phone, socials } = req.body;
  const profile_pic = req.file ? `/uploads/${req.file.filename}` : req.body.profile_pic || null;
  let query = "UPDATE users SET name=?, email=?, phone=?, socials=?";
  let params = [name || null, email || null, phone || null, socials || null];
  if (profile_pic) {
    query += ", profile_pic=?";
    params.push(profile_pic);
  }
  query += " WHERE id=?";
  params.push(req.session.userId);
  db.run(query, params, function(err) {
    if (err) {
      console.error('Error actualizando usuario:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});

// API: Tasks
app.get('/api/tasks', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM tasks WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if (err) {
      console.error('Error obteniendo tareas:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    res.json(rows);
  });
});
app.post('/api/tasks', isAuthenticated, (req, res) => {
  const { title, category } = req.body;
  db.run("INSERT INTO tasks (user_id, title, category) VALUES (?, ?, ?)", [req.session.userId, title, category], function(err) {
    if (err) {
      console.error('Error insertando tarea:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});
app.put('/api/tasks/:id', isAuthenticated, (req, res) => {
  const { title, category, completed } = req.body;
  db.run("UPDATE tasks SET title=?, category=?, completed=? WHERE id=? AND user_id=?", [title, category, completed, req.params.id, req.session.userId], function(err) {
    if (err) {
      console.error('Error actualizando tarea:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});
app.delete('/api/tasks/:id', isAuthenticated, (req, res) => {
  db.run("DELETE FROM tasks WHERE id=? AND user_id=?", [req.params.id, req.session.userId], function(err) {
    if (err) {
      console.error('Error eliminando tarea:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});

// API: Files
app.get('/api/files', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM files WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if (err) {
      console.error('Error obteniendo archivos:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    res.json(rows);
  });
});
app.post('/api/files', isAuthenticated, upload.single('file'), (req, res) => {
  const { category } = req.body;
  const filename = `/uploads/${req.file.filename}`;
  db.run("INSERT INTO files (user_id, filename, category) VALUES (?, ?, ?)", [req.session.userId, filename, category], function(err) {
    if (err) {
      console.error('Error insertando archivo:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true, filename });
  });
});
app.delete('/api/files/:id', isAuthenticated, (req, res) => {
  db.get("SELECT filename FROM files WHERE id=? AND user_id=?", [req.params.id, req.session.userId], (err, file) => {
    if (err) {
      console.error('Error obteniendo archivo para eliminar:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (file) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + file.filename : file.filename);
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error eliminando archivo:', err);
      });
    }
    db.run("DELETE FROM files WHERE id=? AND user_id=?", [req.params.id, req.session.userId], function(err) {
      if (err) {
        console.error('Error eliminando archivo:', err);
        return res.status(500).json({ error: 'Error en la base de datos' });
      }
      res.json({ success: true });
    });
  });
});

// API: Resources
app.get('/api/resources', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM resources WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if (err) {
      console.error('Error obteniendo recursos:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    console.log('Recursos enviados:', rows);
    res.json(rows);
  });
});
app.get('/api/resources/:id', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM resources WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId], (err, row) => {
    if (err) {
      console.error('Error obteniendo recurso:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (!row) return res.status(404).json({ error: 'Recurso no encontrado' });
    res.json(row);
  });
});
app.post('/api/resources', isAuthenticated, upload.single('image'), (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  console.log('Datos recibidos en POST /api/resources:', { user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  db.run(
    "INSERT INTO resources (user_id, title, link, image) VALUES (?, ?, ?, ?)",
    [req.session.userId, title, link, image],
    function(err) {
      if (err) {
        console.error('Error insertando recurso:', err);
        return res.status(500).json({ error: 'Error en la base de datos' });
      }
      console.log('Recurso insertado:', { id: this.lastID, user_id: req.session.userId, title, link, image });
      res.json({ success: true, id: this.lastID });
    }
  );
});
app.put('/api/resources/:id', isAuthenticated, upload.single('image'), (req, res) => {
  const { title, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  console.log('Datos recibidos en PUT /api/resources/:id:', { id: req.params.id, user_id: req.session.userId, title, link, image });
  if (!title || !link) {
    console.error('Faltan campos obligatorios:', { title, link });
    return res.status(400).json({ error: 'El título y el enlace son obligatorios' });
  }
  let query = "UPDATE resources SET title=?, link=?";
  let params = [title, link];
  if (image) {
    query += ", image=?";
    params.push(image);
  }
  query += " WHERE id=? AND user_id=?";
  params.push(req.params.id, req.session.userId);
  db.run(query, params, function(err) {
    if (err) {
      console.error('Error actualizando recurso:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    console.log('Recurso actualizado:', { id: req.params.id });
    res.json({ success: true });
  });
});
app.delete('/api/resources/:id', isAuthenticated, (req, res) => {
  db.get("SELECT image FROM resources WHERE id=? AND user_id=?", [req.params.id, req.session.userId], (err, resource) => {
    if (err) {
      console.error('Error obteniendo recurso para eliminar:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (resource && resource.image) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + resource.image : resource.image);
      fs.unlink(filePath, err => {
        if (err) console.error('Error eliminando imagen:', err);
      });
    }
    db.run("DELETE FROM resources WHERE id=? AND user_id=?", [req.params.id, req.session.userId], function(err) {
      if (err) {
        console.error('Error eliminando recurso:', err);
        return res.status(500).json({ error: 'Error en la base de datos' });
      }
      console.log('Recurso eliminado:', { id: req.params.id });
      res.json({ success: true });
    });
  });
});

// API: Notes
app.get('/api/notes', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM notes WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if (err) {
      console.error('Error obteniendo notas:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    res.json(rows);
  });
});
app.post('/api/notes', isAuthenticated, (req, res) => {
  const { content } = req.body;
  db.run("INSERT INTO notes (user_id, content) VALUES (?, ?)", [req.session.userId, content], function(err) {
    if (err) {
      console.error('Error insertando nota:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});
app.put('/api/notes/:id', isAuthenticated, (req, res) => {
  const { content } = req.body;
  db.run("UPDATE notes SET content=? WHERE id=? AND user_id=?", [content, req.params.id, req.session.userId], function(err) {
    if (err) {
      console.error('Error actualizando nota:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});
app.delete('/api/notes/:id', isAuthenticated, (req, res) => {
  db.run("DELETE FROM notes WHERE id=? AND user_id=?", [req.params.id, req.session.userId], function(err) {
    if (err) {
      console.error('Error eliminando nota:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});

// API: Topics
app.get('/api/topics', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM topics", (err, rows) => {
    if (err) {
      console.error('Error obteniendo temas:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    console.log('Temas enviados:', rows);
    res.json(rows);
  });
});
app.get('/api/topics/:id', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM topics WHERE id = ?", [req.params.id], (err, row) => {
    if (err) {
      console.error('Error obteniendo tema:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (!row) return res.status(404).json({ error: 'Tema no encontrado' });
    res.json(row);
  });
});
app.post('/api/topics', isAuthenticated, upload.single('image'), (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  db.run(
    "INSERT INTO topics (subject, subtopic, explanation, image, link) VALUES (?, ?, ?, ?, ?)",
    [subject, subtopic, explanation, image, link],
    function(err) {
      if (err) {
        console.error('Error insertando tema:', err);
        return res.status(500).json({ error: 'Error en la base de datos' });
      }
      res.json({ success: true });
    }
  );
});
app.put('/api/topics/:id', isAuthenticated, upload.single('image'), (req, res) => {
  const { subject, subtopic, explanation, link } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image || null;
  let query = "UPDATE topics SET subject=?, subtopic=?, explanation=?, link=?";
  let params = [subject, subtopic, explanation, link];
  if (image) {
    query += ", image=?";
    params.push(image);
  }
  query += " WHERE id=?";
  params.push(req.params.id);
  db.run(query, params, function(err) {
    if (err) {
      console.error('Error actualizando tema:', err);
      return res.status(500).json({ error: 'Error en la base de datos' });
    }
    res.json({ success: true });
  });
});
app.delete('/api/topics/:id', isAuthenticated, (req, res) => {
  db.get("SELECT image FROM topics WHERE id=?", [req.params.id], (err, topic) => {
    if (err) {
      console.error('Error obteniendo tema para eliminar:', err);
      return res.status(500).json({ error: 'Error en servidor' });
    }
    if (topic && topic.image) {
      const filePath = path.join(__dirname, isProduction ? '/app/data' + topic.image : topic.image);
      fs.unlink(filePath, err => {
        if (err) console.error('Error eliminando imagen:', err);
      });
    }
    db.run("DELETE FROM topics WHERE id=?", [req.params.id], function(err) {
      if (err) {
        console.error('Error eliminando tema:', err);
        return res.status(500).json({ error: 'Error en la base de datos' });
      }
      res.json({ success: true });
    });
  });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));