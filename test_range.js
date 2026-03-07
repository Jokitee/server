const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run('CREATE TABLE books (id INTEGER PRIMARY KEY, status TEXT, title TEXT)');
    db.run("INSERT INTO books (status, title) VALUES ('available', 'test')");

    // Simulate query where params contains an array
    const countSql = 'SELECT COUNT(*) as total FROM books b WHERE b.status = ?';
    const whereParams = [['available']]; // Array inside array

    db.get(countSql, whereParams, (err, row) => {
        if (err) console.error('Count Error (array inside):', err.message);
        else console.log('Count OK (array inside):', row);
    });
});
