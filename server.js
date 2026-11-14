
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');

const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET;

if (!SECRET || SECRET.length < 32) {
    console.error('Установи JWT_SECRET длиной минимум 32 символа!');
    process.exit(1);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const dirs = ['uploads/projects', 'uploads/files'];

for (const dir of dirs) {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
}

const projectStorage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads/projects'),
    filename: (req, file, cb) => {
        cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase());
    }
});

const fileStorage = multer.diskStorage({
    destination: path.join(__dirname, 'uploads/files'),
    filename: (req, file, cb) => {
        cb(null, crypto.randomUUID());
    }
});

const projectUpload = multer({
    storage: projectStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, ['.catrobat', '.newtrobat'].includes(ext));
    }
});

const fileUpload = multer({
    storage: fileStorage,
    limits: { fileSize: 20 * 1024 * 1024 }
});

function tokenFor(user) {
    return jwt.sign(
        { id: user.id },
        SECRET,
        { expiresIn: '7d' }
    );
}

function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
        ? header.slice(7)
        : '';

    try {
        if (!token) throw new Error('Missing token');

        const payload = jwt.verify(token, SECRET);
        const user = db.prepare(
            'SELECT id, username, avatar FROM users WHERE id = ?'
        ).get(payload.id);

        if (!user) throw new Error('User not found');

        req.user = user;
        next();
    } catch {
        res.status(401).json({ error: 'Требуется авторизация' });
    }
}

function isMember(groupId, userId) {
    return !!db.prepare(
        'SELECT 1 FROM members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);
}

function groupInfo(groupId) {
    const group = db.prepare(
        'SELECT * FROM groups WHERE id = ?'
    ).get(groupId);

    if (!group) return null;

    const members = db.prepare(`
        SELECT users.id, users.username, users.avatar, members.role
        FROM members
        JOIN users ON users.id = members.user_id
        WHERE members.group_id = ?
    `).all(groupId);

    return {
        id: group.id,
        code: group.code,
        members
    };
}

function makeCode() {
    return 'GRP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// AUTH

app.post('/api/register', async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const password = String(req.body.password || '');

        if (username.length < 3 || username.length > 24) {
            return res.status(400).json({
                error: 'Никнейм должен содержать 3–24 символа'
            });
        }

        if (!/^[a-zA-Z0-9а-яА-Я_-]+$/.test(username)) {
            return res.status(400).json({
                error: 'Недопустимые символы в никнейме'
            });
        }

        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({
                error: 'Пароль должен содержать 8–128 символов'
            });
        }

        const hash = await bcrypt.hash(password, 12);

        const result = db.prepare(`
            INSERT INTO users (username, password)
            VALUES (?, ?)
        `).run(username, hash);

        const user = {
            id: Number(result.lastInsertRowid),
            username,
            avatar: '🕷️'
        };

        res.json({
            token: tokenFor(user),
            user
        });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                error: 'Этот никнейм уже занят'
            });
        }

        res.status(500).json({ error: 'Ошибка регистрации' });
    }
});

app.post('/api/login', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = db.prepare(
        'SELECT * FROM users WHERE username = ? COLLATE NOCASE'
    ).get(username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({
            error: 'Неверный никнейм или пароль'
        });
    }

    res.json({
        token: tokenFor(user),
        user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar
        }
    });
});

app.get('/api/me', authenticate, (req, res) => {
    res.json({ user: req.user });
});

// PROFILE

app.patch('/api/profile', authenticate, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const avatar = String(req.body.avatar || '🕷️');
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 24 ||
        !/^[a-zA-Z0-9а-яА-Я_-]+$/.test(username)) {
        return res.status(400).json({
            error: 'Некорректный никнейм'
        });
    }

    if (password && (password.length < 8 || password.length > 128)) {
        return res.status(400).json({
            error: 'Новый пароль должен содержать минимум 8 символов'
        });
    }

    try {
        const hash = password
            ? await bcrypt.hash(password, 12)
            : null;

        if (hash) {
            db.prepare(`
                UPDATE users
                SET username = ?, avatar = ?, password = ?
                WHERE id = ?
            `).run(username, avatar, hash, req.user.id);
        } else {
            db.prepare(`
                UPDATE users
                SET username = ?, avatar = ?
                WHERE id = ?
            `).run(username, avatar, req.user.id);
        }

        const user = db.prepare(`
            SELECT id, username, avatar FROM users WHERE id = ?
        `).get(req.user.id);

        res.json({ user });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                error: 'Никнейм уже занят'
            });
        }

        res.status(500).json({ error: 'Ошибка профиля' });
    }
});

// GROUPS

app.post('/api/groups', authenticate, (req, res) => {
    let code;

    do {
        code = makeCode();
    } while (db.prepare(
        'SELECT id FROM groups WHERE code = ?'
    ).get(code));

    const create = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO groups (code, owner_id)
            VALUES (?, ?)
        `).run(code, req.user.id);

        const id = Number(result.lastInsertRowid);

        db.prepare(`
            INSERT INTO members (group_id, user_id, role)
            VALUES (?, ?, 'leader')
        `).run(id, req.user.id);

        return id;
    });

    const id = create();

    res.json({
        group: groupInfo(id)
    });
});

app.post('/api/groups/join', authenticate, (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();

    const group = db.prepare(
        'SELECT * FROM groups WHERE code = ?'
    ).get(code);

    if (!group) {
        return res.status(404).json({
            error: 'Группа не найдена'
        });
    }

    db.prepare(`
        INSERT OR IGNORE INTO members (group_id, user_id, role)
        VALUES (?, ?, 'member')
    `).run(group.id, req.user.id);

    res.json({ group: groupInfo(group.id) });
});

app.get('/api/groups/:id', authenticate, (req, res) => {
    const id = Number(req.params.id);

    if (!isMember(id, req.user.id)) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    res.json({ group: groupInfo(id) });
});

app.post('/api/groups/:id/leave', authenticate, (req, res) => {
    const id = Number(req.params.id);

    const group = db.prepare(
        'SELECT * FROM groups WHERE id = ?'
    ).get(id);

    if (!group || !isMember(id, req.user.id)) {
        return res.status(404).json({ error: 'Группа не найдена' });
    }

    if (group.owner_id === req.user.id) {
        return res.status(400).json({
            error: 'Создатель должен передать управление перед выходом'
        });
    }

    db.prepare(`
        DELETE FROM members WHERE group_id = ? AND user_id = ?
    `).run(id, req.user.id);

    res.json({ success: true });
});

// CHAT HISTORY

app.get('/api/groups/:id/messages', authenticate, (req, res) => {
    const id = Number(req.params.id);

    if (!isMember(id, req.user.id)) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    const messages = db.prepare(`
        SELECT messages.id, messages.content, messages.created_at,
               users.id AS userId, users.username, users.avatar
        FROM messages
        JOIN users ON users.id = messages.user_id
        WHERE messages.group_id = ?
        ORDER BY messages.id DESC
        LIMIT 100
    `).all(id).reverse();

    res.json({ messages });
});

// PROJECTS

app.get('/api/groups/:id/projects', authenticate, (req, res) => {
    const id = Number(req.params.id);

    if (!isMember(id, req.user.id)) {
        return res.status(403).json({ error: 'Нет доступа' });
    }

    const projects = db.prepare(`
        SELECT projects.id, projects.title, projects.version,
               projects.filename, projects.icon,
               users.username AS author
        FROM projects
        JOIN users ON users.id = projects.user_id
        WHERE projects.group_id = ?
        ORDER BY projects.id DESC
    `).all(id);

    res.json({ projects });
});

app.post('/api/groups/:id/projects',
    authenticate,
    (req, res, next) => {
        const id = Number(req.params.id);

        if (!isMember(id, req.user.id)) {
            return res.status(403).json({ error: 'Нет доступа' });
        }

        next();
    },
    projectUpload.single('project'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                error: 'Выберите файл проекта'
            });
        }

        const title = String(req.body.title || '').trim();
        const version = String(req.body.version || '').trim();

        if (!title || title.length > 80 || !version || version.length > 20) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                error: 'Проверьте название и версию проекта'
            });
        }

        const icon = req.body.icon
            ? String(req.body.icon).slice(0, 1000000)
            : null;

        const result = db.prepare(`
            INSERT INTO projects
            (group_id, user_id, title, version, filename, stored_name, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            Number(req.params.id),
            req.user.id,
            title,
            version,
            path.basename(req.file.originalname),
            req.file.filename,
            icon
        );

        res.json({
            success: true,
            id: Number(result.lastInsertRowid)
        });
    }
);

app.get('/api/projects/:id/download', authenticate, (req, res) => {
    const project = db.prepare(`
        SELECT * FROM projects WHERE id = ?
    `).get(Number(req.params.id));

    if (!project || !isMember(project.group_id, req.user.id)) {
        return res.status(404).json({ error: 'Проект не найден' });
    }

    const file = path.join(
        __dirname,
        'uploads/projects',
        path.basename(project.stored_name)
    );

    if (!fs.existsSync(file)) {
        return res.status(404).json({ error: 'Файл отсутствует' });
    }

    res.download(file, path.basename(project.filename));
});

// FILE ATTACHMENTS

app.post('/api/groups/:id/files',
    authenticate,
    (req, res, next) => {
        if (!isMember(Number(req.params.id), req.user.id)) {
            return res.status(403).json({ error: 'Нет доступа' });
        }
        next();
    },
    fileUpload.single('file'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        const result = db.prepare(`
            INSERT INTO files
            (group_id, user_id, original_name, stored_name, size)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            Number(req.params.id),
            req.user.id,
            path.basename(req.file.originalname),
            req.file.filename,
            req.file.size
        );

        const file = {
            id: Number(result.lastInsertRowid),
            name: path.basename(req.file.originalname),
            size: req.file.size
        };

        io.to('group:' + req.params.id).emit('file', {
            ...file,
            username: req.user.username
        });

        res.json({ file });
    }
);

app.get('/api/files/:id/download', authenticate, (req, res) => {
    const file = db.prepare(
        'SELECT * FROM files WHERE id = ?'
    ).get(Number(req.params.id));

    if (!file || !isMember(file.group_id, req.user.id)) {
        return res.status(404).json({ error: 'Файл не найден' });
    }

    const filePath = path.join(
        __dirname,
        'uploads/files',
        path.basename(file.stored_name)
    );

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Файл отсутствует' });
    }

    res.download(filePath, path.basename(file.original_name));
});

// SOCKET.IO

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        const payload = jwt.verify(token, SECRET);

        const user = db.prepare(`
            SELECT id, username, avatar FROM users WHERE id = ?
        `).get(payload.id);

        if (!user) throw new Error('User not found');

        socket.user = user;
        next();
    } catch {
        next(new Error('Не авторизован'));
    }
});

io.on('connection', socket => {
    socket.on('join-group', groupId => {
        groupId = Number(groupId);

        if (!Number.isInteger(groupId) ||
            !isMember(groupId, socket.user.id)) return;

        socket.join('group:' + groupId);
    });

    socket.on('send-message', data => {
        const groupId = Number(data?.groupId);
        const content = String(data?.content || '').trim();

        if (!Number.isInteger(groupId) ||
            !isMember(groupId, socket.user.id)) return;

        if (!content || content.length > 4000) return;

        const result = db.prepare(`
            INSERT INTO messages (group_id, user_id, content)
            VALUES (?, ?, ?)
        `).run(groupId, socket.user.id, content);

        const message = {
            id: Number(result.lastInsertRowid),
            content,
            userId: socket.user.id,
            username: socket.user.username,
            avatar: socket.user.avatar,
            created_at: new Date().toISOString()
        };

        io.to('group:' + groupId).emit('new-message', message);
    });
});

// ERRORS

app.use((err, req, res, next) => {
    console.error(err.message);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            error: 'Ошибка загрузки или превышен размер файла'
        });
    }

    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('================================');
    console.log('       VIMECHAT SERVER');
    console.log('================================');
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log('SQLite: подключена');
    console.log('Socket.IO: активен');
});
