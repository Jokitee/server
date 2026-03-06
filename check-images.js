const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the database
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Query to check for problematic image_urls
  const sql = `
    SELECT id, title, image_urls 
    FROM books 
    WHERE image_urls IS NOT NULL 
    AND (image_urls LIKE '%/pages/index/%' OR image_urls LIKE '%h%' OR image_urls LIKE '%http%/%' ESCAPE '\')
    ORDER BY id
  `;
  
  console.log('Checking for problematic image_urls...');
  
  db.each(sql, (err, row) => {
    if (err) {
      console.error('Error querying database:', err);
      return;
    }
    
    console.log(`Book ID: ${row.id}, Title: ${row.title}`);
    console.log(`  Image URLs: ${row.image_urls}`);
    
    // Try to parse the image_urls
    try {
      if (row.image_urls) {
        const parsed = JSON.parse(row.image_urls);
        console.log(`  Parsed:`, parsed);
      }
    } catch (parseErr) {
      console.log(`  Parse Error:`, parseErr.message);
      console.log(`  Raw Value:`, row.image_urls);
    }
    console.log('---');
  }, () => {
    console.log('Finished checking database.');
    
    // Also check for any records with suspicious image_urls
    const sql2 = `
      SELECT id, title, image_urls 
      FROM books 
      WHERE image_urls IS NOT NULL
      ORDER BY id
      LIMIT 10
    `;
    
    console.log('\nFirst 10 records with image_urls:');
    db.each(sql2, (err, row) => {
      if (err) {
        console.error('Error querying database:', err);
        return;
      }
      
      console.log(`Book ID: ${row.id}, Title: ${row.title}`);
      console.log(`  Image URLs: ${row.image_urls}`);
      console.log('---');
    }, () => {
      db.close();
    });
  });
});