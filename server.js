const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws');

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ============================================================
// Middleware
// ============================================================

app.use(cors({
    origin: '*', // In production, replace with specific domain
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Conditional debug logging for static file requests
app.use((req, res, next) => {
    if (process.env.DEBUG && req.url.startsWith('/public/')) {
        console.log(`[Static Request] ${req.method} ${req.url}`);
    }
    next();
});

// Serve static files
app.use('/public', express.static(path.join(__dirname, 'public'), {
    fallthrough: false
}));

// ============================================================
// Rate Limiting (basic in-memory implementation)
// ============================================================

const requestCounts = {};
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100;

// Periodic cleanup to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const ip in requestCounts) {
        requestCounts[ip] = requestCounts[ip].filter(time => now - time < WINDOW_MS);
        if (requestCounts[ip].length === 0) {
            delete requestCounts[ip];
        }
    }
}, WINDOW_MS);

app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requestCounts[clientIP]) {
        requestCounts[clientIP] = [];
    }

    requestCounts[clientIP] = requestCounts[clientIP].filter(time => now - time < WINDOW_MS);

    if (requestCounts[clientIP].length >= MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    requestCounts[clientIP].push(now);
    next();
});

// ============================================================
// Database Initialization
// ============================================================

const dbPath = path.resolve(__dirname, 'database.sqlite');
console.log('Connecting to database at:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        return;
    }

    console.log('Connected to the SQLite database.');

    // Use serialize to guarantee execution order for all init statements
    db.serialize(() => {
        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON;');

        // Create Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            contact_info TEXT,
            email TEXT,
            phone TEXT,
            avatar_url TEXT,
            university TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create Books Table
        db.run(`CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            isbn TEXT NOT NULL UNIQUE,
            price REAL,
            original_price REAL,
            condition TEXT CHECK(condition IN ('new', 'like_new', 'good', 'fair', 'poor')) DEFAULT 'good',
            description TEXT,
            category TEXT,
            university TEXT,
            image_urls TEXT,
            seller_id INTEGER,
            buyer_id INTEGER,
            status TEXT DEFAULT 'available' CHECK(status IN ('available', 'reserved', 'sold', 'inactive')),
            views_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL
        )`);

        // Safe schema migrations for existing databases
        const migrations = [
            "ALTER TABLE users ADD COLUMN avatar_url TEXT;",
            "ALTER TABLE users ADD COLUMN university TEXT;",
            "ALTER TABLE users ADD COLUMN openid TEXT UNIQUE;",
            "ALTER TABLE books ADD COLUMN category TEXT;",
            "ALTER TABLE books ADD COLUMN university TEXT;"
        ];

        let completedMigrations = 0;
        const totalMigrations = migrations.length;

        const checkCompletionAndCreateIndexes = () => {
            completedMigrations++;
            if (completedMigrations === totalMigrations) {
                // Create indexes for books AFTER migrations
                db.run('CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_category ON books(category)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_seller_id ON books(seller_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at)');
                db.run('CREATE INDEX IF NOT EXISTS idx_books_university ON books(university)');

                // Create Messages Table
                db.run(`CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender_id INTEGER NOT NULL,
                    receiver_id INTEGER NOT NULL,
                    book_id INTEGER,
                    content TEXT NOT NULL,
                    is_read BOOLEAN DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
                )`);

                // Create indexes for messages
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_book ON messages(book_id)');

                console.log('Database initialization complete.');
            }
        };

        if (totalMigrations === 0) {
            checkCompletionAndCreateIndexes();
        } else {
            migrations.forEach(sql => {
                db.run(sql, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.error(`Migration error (${sql}):`, err.message);
                    }
                    checkCompletionAndCreateIndexes();
                });
            });
        }
    });
});

// ============================================================
// File Upload Configuration (multer)
// ============================================================

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// ============================================================
// Validation Helpers
// ============================================================

const isValidUrl = (url) => {
    try {
        if (url.startsWith('wxfile://') || url.startsWith('http://tmp/')) {
            return true;
        }
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
};

const validateBookData = (req, res, next) => {
    const { title, author, isbn, price, original_price, condition, description, category, image_urls } = req.body;

    if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!isbn || isbn.trim().length === 0) {
        return res.status(400).json({ error: 'ISBN is required' });
    }

    if (!/^\d{10,13}$/.test(isbn.replace(/[-\s]/g, ''))) {
        return res.status(400).json({ error: 'Invalid ISBN format' });
    }

    if (price !== undefined && price !== null && (typeof price !== 'number' || price < 0)) {
        return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    if (original_price !== undefined && original_price !== null && (typeof original_price !== 'number' || original_price < 0)) {
        return res.status(400).json({ error: 'Original price must be a non-negative number' });
    }

    if (condition && !['new', 'like_new', 'good', 'fair', 'poor'].includes(condition)) {
        return res.status(400).json({ error: 'Condition must be one of: new, like_new, good, fair, poor' });
    }

    if (description && description.length > 2000) {
        return res.status(400).json({ error: 'Description is too long (max 2000 characters)' });
    }

    if (category && category.length > 50) {
        return res.status(400).json({ error: 'Category name is too long (max 50 characters)' });
    }

    if (image_urls) {
        try {
            if (typeof image_urls === 'string') {
                const parsed = JSON.parse(image_urls);
                if (!Array.isArray(parsed)) {
                    return res.status(400).json({ error: 'Image URLs must be an array' });
                }
                for (const url of parsed) {
                    if (typeof url !== 'string' || !isValidUrl(url)) {
                        return res.status(400).json({ error: 'All image URLs must be valid strings' });
                    }
                }
            } else if (Array.isArray(image_urls)) {
                for (const url of image_urls) {
                    if (typeof url !== 'string' || !isValidUrl(url)) {
                        return res.status(400).json({ error: 'All image URLs must be valid strings' });
                    }
                }
            } else {
                return res.status(400).json({ error: 'Image URLs must be a string or array' });
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid image URLs format' });
        }
    }

    next();
};

// ============================================================
// API Routes
// ============================================================

// --- Authentication ---
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { userId: ... }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

app.post('/api/login', (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'Login code is required' });
    }

    // MOCK LOGIN LOGIC:
    const mockOpenId = 'mock_open_id_' + code.substring(0, 10);

    db.get('SELECT id, username FROM users WHERE openid = ?', [mockOpenId], (err, row) => {
        if (err) {
            console.error('Database error in mock login:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const sendTokenResponse = (id) => {
            const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ token, userId: id });
        };

        if (row) {
            sendTokenResponse(row.id);
        } else {
            // Create user
            const mockUsername = '用户_' + Math.random().toString(36).substring(2, 8);
            const createSql = 'INSERT INTO users (username, openid) VALUES (?, ?)';
            db.run(createSql, [mockUsername, mockOpenId], function (createErr) {
                if (createErr) { return res.status(500).json({ error: 'Internal server error creating user' }); }
                sendTokenResponse(this.lastID);
            });
        }
    });
});

// --- File Upload ---
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/public/uploads/${req.file.filename}`;
    res.json({
        url: imageUrl,
        filename: req.file.filename
    });
});

// --- Books ---

// 1. GET /api/books (List & Search)
app.get('/api/books', (req, res) => {
    const { search, isbn, page = 1, limit = 20, status, category, condition, university, min_price, max_price, sort_by = 'created_at', order = 'desc' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Use separate param arrays for data query and count query to avoid slice bugs
    let whereClauses = [];
    let whereParams = [];

    // Status filter (default: available)
    if (status && status !== 'all') {
        whereClauses.push('b.status = ?');
        whereParams.push(status);
    } else {
        whereClauses.push('b.status = ?');
        whereParams.push('available');
    }

    // University filter
    if (university && university.trim() && university !== '全部大学') {
        whereClauses.push('b.university = ?');
        whereParams.push(university.trim());
    }

    // Category filter
    if (category && category.trim()) {
        whereClauses.push('b.category = ?');
        whereParams.push(category.trim());
    }

    // Condition filter
    if (condition && condition.trim()) {
        whereClauses.push('b.condition = ?');
        whereParams.push(condition.trim());
    }

    // Price range filters
    if (min_price !== undefined && !isNaN(parseFloat(min_price))) {
        whereClauses.push('b.price >= ?');
        whereParams.push(parseFloat(min_price));
    }
    if (max_price !== undefined && !isNaN(parseFloat(max_price))) {
        whereClauses.push('b.price <= ?');
        whereParams.push(parseFloat(max_price));
    }

    // Search conditions
    if (search && search.trim()) {
        whereClauses.push('(b.title LIKE ? OR b.author LIKE ? OR b.description LIKE ?)');
        const searchTerm = `%${search.trim()}%`;
        whereParams.push(searchTerm, searchTerm, searchTerm);
    }

    // ISBN exact match
    if (isbn && isbn.trim()) {
        whereClauses.push('b.isbn = ?');
        whereParams.push(isbn.trim());
    }

    const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Sorting
    const validSortColumns = ['created_at', 'updated_at', 'price', 'views_count', 'title'];
    const validOrderDirections = ['asc', 'desc'];
    const sortByColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const orderDirection = validOrderDirections.includes(order.toLowerCase()) ? order.toUpperCase() : 'DESC';

    const countSql = `SELECT COUNT(*) as total FROM books b ${whereStr}`;
    const dataSql = `SELECT b.*, u.username as seller_name, u.avatar_url as seller_avatar
                     FROM books b
                     LEFT JOIN users u ON b.seller_id = u.id
                     ${whereStr}
                     ORDER BY b.${sortByColumn} ${orderDirection}
                     LIMIT ${limitNum} OFFSET ${offset}`;

    // Count query uses whereParams, data query also uses whereParams as limit/offset are interpolated
    const dataParams = whereParams;

    db.serialize(() => {
        db.get(countSql, whereParams, (err, countRow) => {
            if (err) {
                console.error('Database error in count query:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            const total = countRow ? countRow.total : 0;
            const totalPages = Math.ceil(total / limitNum);

            db.all(dataSql, dataParams, (err, rows) => {
                if (err) {
                    console.error('Database error in data query:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                res.json({
                    data: rows,
                    pagination: {
                        currentPage: pageNum,
                        totalPages,
                        totalItems: total,
                        itemsPerPage: limitNum
                    }
                });
            });
        });
    });
});

// 2. GET /api/books/:id (Detail)
app.get('/api/books/:id', (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid book ID' });
    }

    const sql = `
        SELECT b.*, u.username as seller_name, u.contact_info as seller_contact, u.email as seller_email, u.phone as seller_phone
        FROM books b
        LEFT JOIN users u ON b.seller_id = u.id
        WHERE b.id = ?
    `;

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Book not found' });
        }

        // Increment views count
        db.run('UPDATE books SET views_count = views_count + 1 WHERE id = ?', [id]);
        res.json({ data: row });
    });
});

// 3. POST /api/books (Publish a new book)
app.post('/api/books', authMiddleware, validateBookData, (req, res) => {
    const { title, author, isbn, price, original_price, condition, description, category, university, image_urls } = req.body;
    const seller_id = req.user.userId;

    const sql = `
        INSERT INTO books (title, author, isbn, price, original_price, condition, description, category, university, image_urls, seller_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')
    `;
    const params = [
        title.trim(),
        author || null,
        isbn.trim(),
        price,
        original_price || null,
        condition || 'good',
        description,
        category || null,
        university || null,
        image_urls || null,
        seller_id
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Database error inserting book:', err);
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'A book with this ISBN already exists' });
            }
            return res.status(500).json({ error: 'Internal server error' });
        }

        res.status(201).json({
            message: 'Book published successfully',
            bookId: this.lastID
        });
    });
});

// --- Users ---

// --- Users ---

// 5.1 GET /api/users/me/published (Get books published by me)
app.get('/api/users/me/published', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const sql = `SELECT * FROM books WHERE seller_id = ? ORDER BY created_at DESC`;

    db.all(sql, [userId], (err, rows) => {
        if (err) {
            console.error('Database error fetching published books:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ data: rows });
    });
});

// 5.2 GET /api/users/me/bought (Get books bought by me)
app.get('/api/users/me/bought', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const sql = `SELECT * FROM books WHERE buyer_id = ? ORDER BY created_at DESC`;

    db.all(sql, [userId], (err, rows) => {
        if (err) {
            console.error('Database error fetching bought books:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ data: rows });
    });
});

// --- Book Status ---

// 6. PUT /api/books/:id/status (Update book status)
app.put('/api/books/:id/status', authMiddleware, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.userId;

    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid book ID' });
    }

    const validStatuses = ['available', 'reserved', 'sold', 'inactive'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be one of: available, reserved, sold, inactive' });
    }

    // Ensure only seller can update status
    db.get('SELECT seller_id FROM books WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (row.seller_id !== userId) {
            return res.status(403).json({ error: 'Forbidden: You are not the seller of this book' });
        }

        const sql = 'UPDATE books SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';

        db.run(sql, [status, id], function (err) {
            if (err) {
                console.error('Database error updating book status:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            res.json({
                message: 'Book status updated successfully',
                bookId: parseInt(id),
                newStatus: status
            });
        });
    });
});

// 6.1 POST /api/books/:id/purchase (Purchase a book)
app.post('/api/books/:id/purchase', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid book ID' });
    }

    db.get('SELECT seller_id, status FROM books WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (row.seller_id === userId) {
            return res.status(400).json({ error: 'You cannot buy your own book' });
        }
        if (row.status !== 'available') {
            return res.status(400).json({ error: 'Book is not available for purchase' });
        }

        const sql = "UPDATE books SET status = 'sold', buyer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        db.run(sql, [userId, id], function (updateErr) {
            if (updateErr) {
                console.error('Database error purchasing book:', updateErr);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.json({ message: 'Purchase successful', bookId: id });
        });
    });
});

// 6.2 DELETE /api/books/:id (Delete book)
app.delete('/api/books/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid book ID' });
    }

    // First check seller
    db.get('SELECT seller_id, image_urls FROM books WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (row.seller_id !== userId) {
            return res.status(403).json({ error: 'Forbidden: You are not the seller' });
        }

        // Delete record
        db.run('DELETE FROM books WHERE id = ?', [id], function (delErr) {
            if (delErr) {
                console.error('Database error deleting book:', delErr);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.json({ message: 'Book deleted successfully' });
        });
    });
});

// --- Messages ---

// 7. GET /api/messages/me (Get latest conversations for user)
app.get('/api/messages/me', authMiddleware, (req, res) => {
    const userId = req.user.userId;

    const sql = `
        SELECT m1.*,
               CASE WHEN m1.sender_id = ? THEN u_receiver.username ELSE u_sender.username END as other_user_name,
               CASE WHEN m1.sender_id = ? THEN u_receiver.avatar_url ELSE u_sender.avatar_url END as other_user_avatar,
               CASE WHEN m1.sender_id = ? THEN m1.receiver_id ELSE m1.sender_id END as other_user_id
        FROM messages m1
        LEFT JOIN messages m2
             ON (
                 (m1.sender_id = m2.sender_id AND m1.receiver_id = m2.receiver_id) OR
                 (m1.sender_id = m2.receiver_id AND m1.receiver_id = m2.sender_id)
             ) AND m1.id < m2.id
        LEFT JOIN users u_sender ON m1.sender_id = u_sender.id
        LEFT JOIN users u_receiver ON m1.receiver_id = u_receiver.id
        WHERE m2.id IS NULL AND (m1.sender_id = ? OR m1.receiver_id = ?)
        ORDER BY m1.created_at DESC
    `;

    db.all(sql, [userId, userId, userId, userId, userId], (err, rows) => {
        if (err) {
            console.error('Database error checking messages:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ data: rows });
    });
});

// 8. GET /api/messages/session/:otherUserId (Get messages between two users)
app.get('/api/messages/session/:otherUserId', authMiddleware, (req, res) => {
    const userId = req.user.userId;
    const { otherUserId } = req.params;

    if (!otherUserId || isNaN(otherUserId)) {
        return res.status(400).json({ error: 'Invalid other user ID' });
    }

    const sql = `
        SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
        ORDER BY m.created_at ASC
    `;

    db.all(sql, [userId, otherUserId, otherUserId, userId], (err, rows) => {
        if (err) {
            console.error('Database error fetching session:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        // Mark as read
        db.run('UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0',
            [userId, otherUserId]);

        res.json({ data: rows });
    });
});

// 9. POST /api/messages (Send new message)
app.post('/api/messages', authMiddleware, (req, res) => {
    const { receiver_id, book_id, content } = req.body;
    const sender_id = req.user.userId;

    if (!receiver_id || !content || content.trim() === '') {
        return res.status(400).json({ error: 'Receiver and content are required' });
    }

    db.get('SELECT id FROM users WHERE id = ?', [receiver_id], (err, receiverRow) => {
        if (err) {
            console.error('Database error checking receiver:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
        if (!receiverRow) {
            return res.status(400).json({ error: 'Receiver user not found' });
        }

        const sql = 'INSERT INTO messages (sender_id, receiver_id, book_id, content) VALUES (?, ?, ?, ?)';
        const params = [sender_id, receiver_id, book_id || null, content.trim()];

        db.run(sql, params, function (err) {
            if (err) {
                console.error('Database error inserting message:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            const messageId = this.lastID;

            // Broadcast via WebSocket
            if (activeClients.has(parseInt(receiver_id))) {
                const receiverWs = activeClients.get(parseInt(receiver_id));
                if (receiverWs.readyState === WebSocket.OPEN) {
                    receiverWs.send(JSON.stringify({
                        type: 'NEW_MESSAGE',
                        payload: {
                            id: messageId,
                            sender_id,
                            receiver_id: parseInt(receiver_id),
                            book_id,
                            content: content.trim(),
                            created_at: new Date().toISOString()
                        }
                    }));
                }
            }

            res.status(201).json({ message: 'Message sent', messageId });
        });
    });
});

// ============================================================
// Utility Routes
// ============================================================

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Default route — API documentation
app.get('/', (req, res) => {
    res.json({
        message: 'Second-hand Book Market API is running',
        version: '1.1.0',
        endpoints: {
            'GET    /api/books': 'List books with search, filter & pagination',
            'GET    /api/books/:id': 'Get book detail',
            'POST   /api/books': 'Create a new book listing',
            'PUT    /api/books/:id/status': 'Update book status',
            'POST   /api/upload': 'Upload an image file',
            'GET    /api/users/me/published': 'Get published books',
            'GET    /api/users/me/bought': 'Get bought books',
            'GET    /api/messages/me': 'Get conversations',
            'GET    /api/messages/session/:uid1/:uid2': 'Get chat history',
            'POST   /api/messages': 'Send a message',
            'GET    /health': 'Health check'
        }
    });
});

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found' });
});

// Global error handler (must be last)
app.use((err, req, res, next) => {
    // Handle multer errors gracefully
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large (max 5MB)' });
        }
        return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// Server Start & Graceful Shutdown
// ============================================================

const activeClients = new Map();
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
    // Expected path /ws?token=XYZ
    const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
    const token = urlParams.get('token');

    if (!token) {
        ws.close(4001, 'Unauthorized');
        return;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.userId;
        activeClients.set(userId, ws);

        ws.on('close', () => {
            if (activeClients.get(userId) === ws) {
                activeClients.delete(userId);
            }
        });

        ws.on('error', console.error);
    } catch (err) {
        ws.close(4001, 'Unauthorized');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`WebSocket server is running on ws://localhost:${PORT}/ws`);
    console.log('\nAvailable endpoints:');
    console.log('  GET    /api/books          - List books with search & filter');
    console.log('  GET    /api/books/:id      - Get a specific book');
    console.log('  POST   /api/books          - Create a new book listing');
    console.log('  PUT    /api/books/:id/status - Update book status');
    console.log('  POST   /api/upload         - Upload an image');
    console.log('  GET    /api/messages/me    - Get conversations (auth)');
    console.log('  POST   /api/messages       - Send a message');
    console.log('  GET    /health             - Health check');
});

// Graceful shutdown
function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed.');
        db.close((err) => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed.');
            process.exit(0);
        });
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcing shutdown.');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
