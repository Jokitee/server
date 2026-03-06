const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(cors({
    origin: '*', // In production, replace with specific domain
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Debugging middleware for static files
app.use((req, res, next) => {
    if (req.url.startsWith('/public/')) {
        console.log(`[Static Request] ${req.method} ${req.url}`);
    }
    next();
});

// Serve static files (like uploaded images or generated presets). 
// Remove the '/public' prefix aliasing to ensure the physical path perfectly matches the URL path
app.use('/public', express.static(path.join(__dirname, 'public'), {
    fallthrough: false
}));

// Rate limiting middleware (basic implementation)
const requestCounts = {};
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100; // Max requests per window

app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requestCounts[clientIP]) {
        requestCounts[clientIP] = [];
    }

    // Clean old requests
    requestCounts[clientIP] = requestCounts[clientIP].filter(time => now - time < WINDOW_MS);

    if (requestCounts[clientIP].length >= MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    requestCounts[clientIP].push(now);
    next();
});

// Initialize SQLite Database
const dbPath = path.resolve(__dirname, 'database.sqlite');
console.log('Connecting to database at:', dbPath); // Add explicit logging for the user's VM
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON;', (err) => {
            if (err) {
                console.error('Error enabling foreign keys:', err.message);
            } else {
                console.log('Foreign keys enabled');
            }
        });

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
        )`, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
            } else {
                console.log('Users table ready');
            }
        });

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
            image_urls TEXT, -- JSON array of image URLs
            seller_id INTEGER,
            buyer_id INTEGER,
            status TEXT DEFAULT 'available' CHECK(status IN ('available', 'reserved', 'sold', 'inactive')), -- 更精确的状态定义
            views_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL
        )`, (err) => {
            if (err) {
                console.error('Error creating books table:', err.message);
            } else {
                console.log('Books table ready');

                // Create indexes for better performance
                db.run('CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)', (err) => {
                    if (err) console.error('Error creating title index:', err.message);
                });

                db.run('CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)', (err) => {
                    if (err) console.error('Error creating isbn index:', err.message);
                });

                db.run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)', (err) => {
                    if (err) console.error('Error creating status index:', err.message);
                });

                db.run('CREATE INDEX IF NOT EXISTS idx_books_category ON books(category)', (err) => {
                    if (err) console.error('Error creating category index:', err.message);
                });

                db.run('CREATE INDEX IF NOT EXISTS idx_books_seller_id ON books(seller_id)', (err) => {
                    if (err) console.error('Error creating seller_id index:', err.message);
                });

                db.run('CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at)', (err) => {
                    if (err) console.error('Error creating date index:', err.message);
                });

                // In a production environment with existing data, this would need an ALTER TABLE
                // db.run('CREATE INDEX IF NOT EXISTS idx_books_university ON books(university)', (err) => {
                //     if (err) console.error('Error creating university index:', err.message);
                // });
            }
        });

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
        )`, (err) => {
            if (err) {
                console.error('Error creating messages table:', err.message);
            } else {
                console.log('Messages table ready');
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id)');
                db.run('CREATE INDEX IF NOT EXISTS idx_messages_book ON messages(book_id)');
            }
        });

        // Perform safe schema migrations for existing databases
        const migrations = [
            "ALTER TABLE users ADD COLUMN avatar_url TEXT;",
            "ALTER TABLE users ADD COLUMN university TEXT;",
            "ALTER TABLE books ADD COLUMN university TEXT;"
        ];

        migrations.forEach(sql => {
            db.run(sql, (err) => {
                if (err) {
                    // Ignore "duplicate column name" errors which mean that the column already exists
                    if (!err.message.includes('duplicate column name')) {
                        console.error(`Migration error (${sql}):`, err.message);
                    }
                } else {
                    console.log(`Migration successful: ${sql}`);
                }
            });
        });
    }
});

// Validation middleware
const validateBookData = (req, res, next) => {
    const { title, author, isbn, price, original_price, condition, description, category, image_urls } = req.body;

    // Basic validation
    if (!title || title.trim().length === 0) {
        console.log('[Validate Error] Title is required');
        return res.status(400).json({ error: 'Title is required' });
    }

    if (!isbn || isbn.trim().length === 0) {
        console.log('[Validate Error] ISBN is required');
        return res.status(400).json({ error: 'ISBN is required' });
    }

    // Validate ISBN format (basic check)
    if (!/^\d{10,13}$/.test(isbn.replace(/[-\s]/g, ''))) {
        console.log('[Validate Error] Invalid ISBN format:', isbn);
        return res.status(400).json({ error: 'Invalid ISBN format' });
    }

    // Validate price if provided
    if (price !== undefined && (typeof price !== 'number' || price <= 0)) {
        return res.status(400).json({ error: 'Price must be a positive number' });
    }

    // Validate original_price if provided
    if (original_price !== undefined && (typeof original_price !== 'number' || original_price <= 0)) {
        return res.status(400).json({ error: 'Original price must be a positive number' });
    }

    // Validate condition if provided
    if (condition && !['new', 'like_new', 'good', 'fair', 'poor'].includes(condition)) {
        return res.status(400).json({ error: 'Condition must be one of: new, like_new, good, fair, poor' });
    }

    // Validate description length if provided
    if (description && description.length > 2000) {
        return res.status(400).json({ error: 'Description is too long (max 2000 characters)' });
    }

    // Validate category if provided
    if (category && category.length > 50) {
        return res.status(400).json({ error: 'Category name is too long (max 50 characters)' });
    }

    // Validate image_urls if provided
    if (image_urls) {
        try {
            // If it's a string, try to parse it as JSON array
            if (typeof image_urls === 'string') {
                const parsed = JSON.parse(image_urls);
                if (!Array.isArray(parsed)) {
                    console.log('[Validate Error] Image URLs string is not an array format');
                    return res.status(400).json({ error: 'Image URLs must be an array' });
                }
                // Validate each URL in the array
                for (const url of parsed) {
                    if (typeof url !== 'string' || !isValidUrl(url)) {
                        console.log('[Validate Error] Invalid URL in parsed array:', url);
                        return res.status(400).json({ error: 'All image URLs must be valid strings' });
                    }
                }
            } else if (Array.isArray(image_urls)) {
                // Validate each URL in the array
                for (const url of image_urls) {
                    if (typeof url !== 'string' || !isValidUrl(url)) {
                        console.log('[Validate Error] Invalid URL in raw array:', url);
                        return res.status(400).json({ error: 'All image URLs must be valid strings' });
                    }
                }
            } else {
                console.log('[Validate Error] Image URLs is neither string nor array:', typeof image_urls);
                return res.status(400).json({ error: 'Image URLs must be a string or array' });
            }
        } catch (e) {
            console.log('[Validate Error] Invalid image URLs JSON format:', e.message);
            return res.status(400).json({ error: 'Invalid image URLs format' });
        }
    }

    next();
};

// Helper function to validate URL format, allowing WeChat local/temp protocols
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

// API Routes

// 1. GET /api/books (List & Search) - Updated to filter by status, category, condition, and university
app.get('/api/books', (req, res) => {
    const { search, isbn, page = 1, limit = 20, status, category, condition, university, min_price, max_price, sort_by = 'created_at', order = 'desc' } = req.query;

    // Convert page and limit to integers with defaults
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;

    let sql = `SELECT b.*, u.username as seller_name, u.avatar_url as seller_avatar
               FROM books b 
               LEFT JOIN users u ON b.seller_id = u.id 
               WHERE 1=1`;
    let countSql = 'SELECT COUNT(*) as total FROM books b WHERE 1=1';
    let params = [];

    // Add status filter (only show available books by default)
    if (status && status !== 'all') {
        sql += ' AND b.status = ?';
        countSql += ' AND b.status = ?';
        params.push(status);
    } else {
        // By default, only show available books
        sql += ' AND b.status = ?';
        countSql += ' AND b.status = ?';
        params.push('available');
    }

    // Add university filter
    if (university && university.trim() && university !== '全部大学') {
        sql += ' AND b.university = ?';
        countSql += ' AND b.university = ?';
        params.push(university.trim());
    }

    // Add category filter
    if (category && category.trim()) {
        sql += ' AND b.category = ?';
        countSql += ' AND b.category = ?';
        params.push(category.trim());
    }

    // Add condition filter
    if (condition && condition.trim()) {
        sql += ' AND b.condition = ?';
        countSql += ' AND b.condition = ?';
        params.push(condition.trim());
    }

    // Add price range filters
    if (min_price !== undefined && !isNaN(parseFloat(min_price))) {
        sql += ' AND b.price >= ?';
        countSql += ' AND b.price >= ?';
        params.push(parseFloat(min_price));
    }
    if (max_price !== undefined && !isNaN(parseFloat(max_price))) {
        sql += ' AND b.price <= ?';
        countSql += ' AND b.price <= ?';
        params.push(parseFloat(max_price));
    }

    // Add search conditions
    if (search && search.trim()) {
        sql += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.description LIKE ?)';
        countSql += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.description LIKE ?)';
        const searchTerm = `%${search.trim()}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (isbn && isbn.trim()) {
        sql += ' AND b.isbn = ?';
        countSql += ' AND b.isbn = ?';
        params.push(isbn.trim());
    }

    // Add sorting
    const validSortColumns = ['created_at', 'updated_at', 'price', 'views_count', 'title'];
    const validOrderDirections = ['asc', 'desc'];
    const sortByColumn = validSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const orderDirection = validOrderDirections.includes(order.toLowerCase()) ? order.toUpperCase() : 'DESC';
    sql += ` ORDER BY b.${sortByColumn} ${orderDirection} LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    // Execute both queries in parallel
    db.serialize(() => {
        // Get total count
        db.get(countSql, params.slice(0, -2), (err, countRow) => {
            if (err) {
                console.error('Database error in count query:', err);
                return res.status(500).json({ error: err.message });
            }

            const total = countRow ? countRow.total : 0;
            const totalPages = Math.ceil(total / limitNum);

            // Get actual data
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Database error in data query:', err);
                    return res.status(500).json({ error: err.message });
                }

                res.json({
                    data: rows,
                    pagination: {
                        currentPage: pageNum,
                        totalPages: totalPages,
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

    // Validate ID
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
        db.run('UPDATE books SET views_count = views_count + 1 WHERE id = ?', [id], (updateErr) => {
            if (updateErr) {
                console.error('Error updating views count:', updateErr);
            }
            res.json({ data: row });
        });
    });
});

// 3. POST /api/books (Publish a new book)
app.post('/api/books', validateBookData, (req, res) => {
    const { title, author, isbn, price, original_price, condition, description, category, university, image_urls, seller_id } = req.body;

    // If seller_id is provided, verify it exists
    if (seller_id) {
        db.get('SELECT id FROM users WHERE id = ?', [seller_id], (err, row) => {
            if (err) {
                console.error('Database error checking seller:', err);
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.status(400).json({ error: 'Seller does not exist' });
            }

            // Proceed with inserting the book
            insertBook();
        });
    } else {
        // No seller verification needed
        insertBook();
    }

    function insertBook() {
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
            seller_id || null
        ];

        db.run(sql, params, function (err) {
            if (err) {
                console.error('Database error inserting book:', err);

                // Check if it's a duplicate ISBN error
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'A book with this ISBN already exists' });
                }

                return res.status(500).json({ error: err.message });
            }

            res.status(201).json({
                message: 'Book published successfully',
                bookId: this.lastID
            });
        });
    }
});

// 4. POST /api/users (Create a new user)
app.post('/api/users', (req, res) => {
    const { username, contact_info, email, phone, avatar_url, university } = req.body;

    if (!username || username.trim().length === 0) {
        return res.status(400).json({ error: 'Username is required' });
    }

    // Validate email if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate phone if provided
    if (phone && !/^[\+]?[1-9][\d]{0,15}$/.test(phone.replace(/[-\s\(\)]/g, ''))) {
        return res.status(400).json({ error: 'Invalid phone number format' });
    }

    const sql = 'INSERT INTO users (username, contact_info, email, phone, avatar_url, university) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [username.trim(), contact_info || null, email || null, phone || null, avatar_url || null, university || null];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Database error inserting user:', err);

            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: 'Username already exists' });
            }

            return res.status(500).json({ error: err.message });
        }

        res.status(201).json({
            message: 'User created successfully',
            userId: this.lastID
        });
    });
});

// 5. GET /api/users/:id (Get user info)
app.get('/api/users/:id', (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }

    const sql = 'SELECT id, username, contact_info, email, phone, avatar_url, created_at, updated_at FROM users WHERE id = ?';

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: err.message });
        }

        if (!row) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ data: row });
    });
});

// 6. PUT /api/books/:id/status (Update book status)
app.put('/api/books/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // Validate ID
    if (!id || isNaN(id) || parseInt(id) <= 0) {
        return res.status(400).json({ error: 'Invalid book ID' });
    }

    // Validate status - use the same values as defined in the table schema
    const validStatuses = ['available', 'reserved', 'sold', 'inactive'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be one of: available, reserved, sold, inactive' });
    }

    const sql = 'UPDATE books SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';

    db.run(sql, [status, id], function (err) {
        if (err) {
            console.error('Database error updating book status:', err);
            return res.status(500).json({ error: err.message });
        }

        if (this.changes === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }

        res.json({
            message: 'Book status updated successfully',
            bookId: parseInt(id),
            newStatus: status
        });
    });
});

// 7. GET /api/messages/:userId (Get latest conversations for user)
app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;

    if (!userId || isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get the most recent message per conversation partner
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
            return res.status(500).json({ error: err.message });
        }
        res.json({ data: rows });
    });
});

// 8. GET /api/messages/session/:userId/:otherUserId (Get messages between two users)
app.get('/api/messages/session/:userId/:otherUserId', (req, res) => {
    const { userId, otherUserId } = req.params;

    if (!userId || isNaN(userId) || !otherUserId || isNaN(otherUserId)) {
        return res.status(400).json({ error: 'Invalid user IDs' });
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
            return res.status(500).json({ error: err.message });
        }

        // Mark as read if receiver_id is userId
        db.run(`UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0`,
            [userId, otherUserId]);

        res.json({ data: rows });
    });
});

// 9. POST /api/messages (Send new message)
app.post('/api/messages', (req, res) => {
    const { sender_id, receiver_id, book_id, content } = req.body;

    if (!sender_id || !receiver_id || !content || content.trim() === '') {
        return res.status(400).json({ error: 'Sender, receiver, and content are required' });
    }

    const sql = `INSERT INTO messages (sender_id, receiver_id, book_id, content) VALUES (?, ?, ?, ?)`;
    const params = [sender_id, receiver_id, book_id || null, content.trim()];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Database error inserting message:', err);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Message sent', messageId: this.lastID });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Default route
app.get('/', (req, res) => {
    res.json({
        message: 'Second-hand Book Market API is running',
        version: '1.0.0',
        endpoints: {
            'GET /api/books': 'Get all books with optional search',
            'GET /api/books/:id': 'Get a specific book',
            'POST /api/books': 'Create a new book listing',
            'POST /api/users': 'Create a new user',
            'GET /api/users/:id': 'Get user info',
            'GET /health': 'Health check'
        }
    });
});

// 404 handler (Catch-all for unhandled routes)
app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware (Must be last)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    // Log API endpoints for reference
    console.log('\nAvailable endpoints:');
    console.log('  GET    /api/books          - Get all books with optional search');
    console.log('  GET    /api/books/:id      - Get a specific book');
    console.log('  POST   /api/books          - Create a new book listing');
    console.log('  POST   /api/users          - Create a new user');
    console.log('  GET    /api/users/:id      - Get user info');
    console.log('  GET    /health             - Health check');
});

module.exports = app;
