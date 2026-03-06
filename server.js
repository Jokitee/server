const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite Database
const dbPath = path.resolve(__dirname, 'database.sqlite');
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            isbn TEXT NOT NULL,
            price REAL,
            description TEXT,
            seller_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL
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
                
                db.run('CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at)', (err) => {
                    if (err) console.error('Error creating date index:', err.message);
                });
            }
        });
    }
});

// Validation middleware
const validateBookData = (req, res, next) => {
    const { title, isbn, price, description } = req.body;
    
    // Basic validation
    if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!isbn || isbn.trim().length === 0) {
        return res.status(400).json({ error: 'ISBN is required' });
    }
    
    // Validate ISBN format (basic check)
    if (!/^\d{10,13}$/.test(isbn.replace(/[-\s]/g, ''))) {
        return res.status(400).json({ error: 'Invalid ISBN format' });
    }
    
    // Validate price if provided
    if (price !== undefined && (isNaN(price) || parseFloat(price) <= 0)) {
        return res.status(400).json({ error: 'Price must be a positive number' });
    }
    
    // Validate description length if provided
    if (description && description.length > 1000) {
        return res.status(400).json({ error: 'Description is too long (max 1000 characters)' });
    }
    
    next();
};

// API Routes

// 1. GET /api/books (List & Search)
app.get('/api/books', (req, res) => {
    const { search, isbn, page = 1, limit = 20 } = req.query;
    
    // Convert page and limit to integers with defaults
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100 per page
    const offset = (pageNum - 1) * limitNum;
    
    let sql = 'SELECT b.*, u.username as seller_name FROM books b LEFT JOIN users u ON b.seller_id = u.id WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM books WHERE 1=1';
    let params = [];

    // Add search conditions
    if (search && search.trim()) {
        sql += ' AND (b.title LIKE ? OR b.description LIKE ?)';
        countSql += ' AND (title LIKE ? OR description LIKE ?)';
        const searchTerm = `%${search.trim()}%`;
        params.push(searchTerm, searchTerm);
    }
    
    if (isbn && isbn.trim()) {
        sql += ' AND b.isbn = ?';
        countSql += ' AND isbn = ?';
        params.push(isbn.trim());
    }
    
    sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
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
        SELECT b.*, u.username as seller_name, u.contact_info as seller_contact 
        FROM books b 
        LEFT JOIN users u ON b.seller_id = u.id 
        WHERE b.id = ?
    `;
    
    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        res.json({ data: row });
    });
});

// 3. POST /api/books (Publish a new book)
app.post('/api/books', validateBookData, (req, res) => {
    const { title, isbn, price, description, seller_id } = req.body;
    
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
            INSERT INTO books (title, isbn, price, description, seller_id) 
            VALUES (?, ?, ?, ?, ?)
        `;
        const params = [title.trim(), isbn.trim(), price, description, seller_id || null];

        db.run(sql, params, function(err) {
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
    const { username, contact_info } = req.body;
    
    if (!username || username.trim().length === 0) {
        return res.status(400).json({ error: 'Username is required' });
    }
    
    const sql = 'INSERT INTO users (username, contact_info) VALUES (?, ?)';
    const params = [username.trim(), contact_info || null];
    
    db.run(sql, params, function(err) {
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
    
    const sql = 'SELECT id, username, contact_info, created_at FROM users WHERE id = ?';
    
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
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
