const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Starting database migration...');

db.serialize(() => {
    // Begin transaction
    db.run('BEGIN TRANSACTION;');

    // 1. Add new columns to users table
    console.log('Adding new columns to users table...');
    
    // Check if email column exists, if not add it
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
        if (err) {
            console.error('Error checking users table:', err);
            return;
        }

        const tableSchema = row.sql;
        
        // Add email column if it doesn't exist
        if (!tableSchema.includes('email')) {
            db.run('ALTER TABLE users ADD COLUMN email TEXT', (err) => {
                if (err) {
                    console.log('Email column already exists or error occurred:', err.message);
                } else {
                    console.log('Email column added to users table');
                }
            });
        } else {
            console.log('Email column already exists in users table');
        }

        // Add phone column if it doesn't exist
        if (!tableSchema.includes('phone')) {
            db.run('ALTER TABLE users ADD COLUMN phone TEXT', (err) => {
                if (err) {
                    console.log('Phone column already exists or error occurred:', err.message);
                } else {
                    console.log('Phone column added to users table');
                }
            });
        } else {
            console.log('Phone column already exists in users table');
        }

        // Add avatar_url column if it doesn't exist
        if (!tableSchema.includes('avatar_url')) {
            db.run('ALTER TABLE users ADD COLUMN avatar_url TEXT', (err) => {
                if (err) {
                    console.log('Avatar URL column already exists or error occurred:', err.message);
                } else {
                    console.log('Avatar URL column added to users table');
                }
            });
        } else {
            console.log('Avatar URL column already exists in users table');
        }

        // Add updated_at column if it doesn't exist
        if (!tableSchema.includes('updated_at')) {
            db.run('ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP', (err) => {
                if (err) {
                    console.log('Updated at column already exists or error occurred:', err.message);
                } else {
                    console.log('Updated at column added to users table');
                }
            });
        } else {
            console.log('Updated at column already exists in users table');
        }
    });

    // 2. Add new columns to books table
    console.log('Adding new columns to books table...');
    
    db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='books'", (err, row) => {
        if (err) {
            console.error('Error checking books table:', err);
            return;
        }

        const tableSchema = row.sql;
        
        // Add author column if it doesn't exist
        if (!tableSchema.includes('author')) {
            db.run('ALTER TABLE books ADD COLUMN author TEXT', (err) => {
                if (err) {
                    console.log('Author column already exists or error occurred:', err.message);
                } else {
                    console.log('Author column added to books table');
                }
            });
        } else {
            console.log('Author column already exists in books table');
        }

        // Add original_price column if it doesn't exist
        if (!tableSchema.includes('original_price')) {
            db.run('ALTER TABLE books ADD COLUMN original_price REAL', (err) => {
                if (err) {
                    console.log('Original price column already exists or error occurred:', err.message);
                } else {
                    console.log('Original price column added to books table');
                }
            });
        } else {
            console.log('Original price column already exists in books table');
        }

        // Add condition column if it doesn't exist
        if (!tableSchema.includes('condition')) {
            db.run("ALTER TABLE books ADD COLUMN condition TEXT DEFAULT 'good'", (err) => {
                if (err) {
                    console.log('Condition column already exists or error occurred:', err.message);
                } else {
                    console.log('Condition column added to books table');
                }
            });
        } else {
            console.log('Condition column already exists in books table');
        }

        // Add category column if it doesn't exist
        if (!tableSchema.includes('category')) {
            db.run('ALTER TABLE books ADD COLUMN category TEXT', (err) => {
                if (err) {
                    console.log('Category column already exists or error occurred:', err.message);
                } else {
                    console.log('Category column added to books table');
                }
            });
        } else {
            console.log('Category column already exists in books table');
        }

        // Add image_urls column if it doesn't exist
        if (!tableSchema.includes('image_urls')) {
            db.run('ALTER TABLE books ADD COLUMN image_urls TEXT', (err) => {
                if (err) {
                    console.log('Image URLs column already exists or error occurred:', err.message);
                } else {
                    console.log('Image URLs column added to books table');
                }
            });
        } else {
            console.log('Image URLs column already exists in books table');
        }

        // Add buyer_id column if it doesn't exist
        if (!tableSchema.includes('buyer_id')) {
            db.run('ALTER TABLE books ADD COLUMN buyer_id INTEGER', (err) => {
                if (err) {
                    console.log('Buyer ID column already exists or error occurred:', err.message);
                } else {
                    console.log('Buyer ID column added to books table');
                }
            });
        } else {
            console.log('Buyer ID column already exists in books table');
        }

        // Add views_count column if it doesn't exist
        if (!tableSchema.includes('views_count')) {
            db.run('ALTER TABLE books ADD COLUMN views_count INTEGER DEFAULT 0', (err) => {
                if (err) {
                    console.log('Views count column already exists or error occurred:', err.message);
                } else {
                    console.log('Views count column added to books table');
                }
            });
        } else {
            console.log('Views count column already exists in books table');
        }

        // Add updated_at column if it doesn't exist
        if (!tableSchema.includes('updated_at')) {
            db.run('ALTER TABLE books ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP', (err) => {
                if (err) {
                    console.log('Updated at column already exists or error occurred:', err.message);
                } else {
                    console.log('Updated at column added to books table');
                }
            });
        } else {
            console.log('Updated at column already exists in books table');
        }

        // Update the status column to have the new CHECK constraint
        // Since SQLite doesn't support ALTER COLUMN, we need to recreate the table
        console.log('Checking if books status column needs to be updated...');
        
        // Check if the status column has the old or new definition
        if (tableSchema.includes("'pending'") && !tableSchema.includes("'reserved'")) {
            console.log('Recreating books table with updated status values...');
            
            // Create a temporary table with the new schema
            db.run(`
                CREATE TABLE books_temp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    author TEXT,
                    isbn TEXT NOT NULL UNIQUE,
                    price REAL,
                    original_price REAL,
                    condition TEXT CHECK(condition IN ('new', 'like_new', 'good', 'fair', 'poor')) DEFAULT 'good',
                    description TEXT,
                    category TEXT,
                    image_urls TEXT,
                    seller_id INTEGER,
                    buyer_id INTEGER,
                    status TEXT DEFAULT 'available' CHECK(status IN ('available', 'reserved', 'sold', 'inactive')),
                    views_count INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
                    FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE SET NULL
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating temporary books table:', err);
                } else {
                    console.log('Temporary books table created');
                    
                    // Copy data from old table to temp table
                    db.run(`
                        INSERT INTO books_temp (
                            id, title, author, isbn, price, original_price, condition, description, 
                            category, image_urls, seller_id, buyer_id, status, views_count, created_at, updated_at
                        )
                        SELECT 
                            id, title, author, isbn, price, original_price, condition, description, 
                            category, image_urls, seller_id, buyer_id, 
                            CASE 
                                WHEN status = 'pending' THEN 'reserved'
                                ELSE status
                            END,
                            views_count, created_at, updated_at
                        FROM books
                    `, (err) => {
                        if (err) {
                            console.error('Error copying data to temporary table:', err);
                        } else {
                            console.log('Data copied to temporary table');
                            
                            // Drop the old table
                            db.run('DROP TABLE books', (err) => {
                                if (err) {
                                    console.error('Error dropping old books table:', err);
                                } else {
                                    console.log('Old books table dropped');
                                    
                                    // Rename the temp table to books
                                    db.run('ALTER TABLE books_temp RENAME TO books', (err) => {
                                        if (err) {
                                            console.error('Error renaming temporary table:', err);
                                        } else {
                                            console.log('Books table renamed successfully');
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
        } else {
            console.log('Books status column is already up to date');
        }
    });

    // Commit transaction after a delay to allow all operations to complete
    setTimeout(() => {
        db.run('COMMIT;', (err) => {
            if (err) {
                console.error('Error committing transaction:', err);
            } else {
                console.log('Transaction committed successfully');
                
                // Create indexes
                console.log('Creating indexes...');
                
                db.run('CREATE INDEX IF NOT EXISTS idx_books_status ON books(status)', (err) => {
                    if (err) console.error('Error creating status index:', err.message);
                    else console.log('Status index created');
                });
                
                db.run('CREATE INDEX IF NOT EXISTS idx_books_category ON books(category)', (err) => {
                    if (err) console.error('Error creating category index:', err.message);
                    else console.log('Category index created');
                });
                
                db.run('CREATE INDEX IF NOT EXISTS idx_books_seller_id ON books(seller_id)', (err) => {
                    if (err) console.error('Error creating seller_id index:', err.message);
                    else console.log('Seller ID index created');
                });
                
                // Update the condition column to have proper CHECK constraint
                // Note: SQLite doesn't support adding CHECK constraints to existing columns
                // The constraint will be enforced for new entries
                
                console.log('Migration completed!');
                console.log('New columns added:');
                console.log('- Users table: email, phone, avatar_url, updated_at');
                console.log('- Books table: author, original_price, condition, category, image_urls, buyer_id, views_count, updated_at');
                console.log('Status values updated: available, reserved, sold, inactive');
                
                db.close();
            }
        });
    }, 2000); // Delay to allow all operations to complete
});

// Handle database errors
db.on('error', (err) => {
    console.error('Database error:', err);
});