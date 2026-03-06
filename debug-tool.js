const axios = require('axios');

class DebugTool {
  constructor(baseURL = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL: baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async healthCheck() {
    try {
      console.log('🔍 Checking server health...');
      const response = await this.client.get('/health');
      console.log('✅ Server is running:', response.data);
      return true;
    } catch (error) {
      console.error('❌ Server health check failed:', error.message);
      return false;
    }
  }

  async testEndpoints() {
    console.log('\n🧪 Testing API endpoints...');

    try {
      // Test GET /api/books
      console.log('\n📋 Testing GET /api/books...');
      const booksResponse = await this.client.get('/api/books');
      console.log('✅ GET /api/books:', booksResponse.data.pagination);

      // Test GET /api/books with search
      console.log('\n🔍 Testing GET /api/books?search=test...');
      const searchResponse = await this.client.get('/api/books?search=test');
      console.log('✅ Search works, found:', searchResponse.data.pagination.totalItems, 'items');

      // Test GET root endpoint
      console.log('\n🏠 Testing GET / (root)...');
      const rootResponse = await this.client.get('/');
      console.log('✅ Root endpoint works, version:', rootResponse.data.version);

      return true;
    } catch (error) {
      console.error('❌ Endpoint testing failed:', error.message);
      return false;
    }
  }

  async createTestUser() {
    console.log('\n👤 Creating test user...');
    try {
      const userData = {
        username: `test_user_${Date.now()}`,
        contact_info: 'test@example.com'
      };
      
      const response = await this.client.post('/api/users', userData);
      console.log('✅ Test user created:', response.data);
      return response.data.userId;
    } catch (error) {
      console.error('❌ Failed to create test user:', error.message);
      return null;
    }
  }

  async createTestBook(userId = null) {
    console.log('\n📚 Creating test book...');
    try {
      const bookData = {
        title: `Test Book ${Date.now()}`,
        isbn: `${Math.floor(Math.random() * 9000000000000 + 1000000000000)}`, // Random 13-digit ISBN
        price: Math.random() * 100 + 1, // Random price between 1-101
        description: 'This is a test book created for debugging purposes.',
        seller_id: userId
      };

      const response = await this.client.post('/api/books', bookData);
      console.log('✅ Test book created:', response.data);
      return response.data.bookId;
    } catch (error) {
      console.error('❌ Failed to create test book:', error.message);
      return null;
    }
  }

  async getBookDetails(bookId) {
    if (!bookId) {
      console.log('\n⚠️  Skipping book details test (no book ID)');
      return;
    }

    console.log('\n📖 Getting book details...');
    try {
      const response = await this.client.get(`/api/books/${bookId}`);
      console.log('✅ Book details retrieved:', response.data.data.title);
    } catch (error) {
      console.error('❌ Failed to get book details:', error.message);
    }
  }

  async getUserDetails(userId) {
    if (!userId) {
      console.log('\n⚠️  Skipping user details test (no user ID)');
      return;
    }

    console.log('\n👥 Getting user details...');
    try {
      const response = await this.client.get(`/api/users/${userId}`);
      console.log('✅ User details retrieved:', response.data.data.username);
    } catch (error) {
      console.error('❌ Failed to get user details:', error.message);
    }
  }

  async runFullDebug() {
    console.log('🚀 Starting server debug process...\n');
    console.log('Server URL:', this.baseURL);
    console.log('Timestamp:', new Date().toISOString());

    // Step 1: Health check
    const isHealthy = await this.healthCheck();
    if (!isHealthy) {
      console.log('\n💥 Server is not responding. Please make sure it\'s running.');
      return;
    }

    // Step 2: Test basic endpoints
    const endpointsWorking = await this.testEndpoints();
    if (!endpointsWorking) {
      console.log('\n⚠️  Some endpoints are not working properly.');
    }

    // Step 3: Create test data
    const userId = await this.createTestUser();
    const bookId = await this.createTestBook(userId);

    // Step 4: Test retrieving data
    await this.getBookDetails(bookId);
    await this.getUserDetails(userId);

    console.log('\n🎉 Debug process completed!');
    console.log('💡 Tip: Check the database file for the created records.');
    console.log('📊 Database location: server/database.sqlite');
  }

  async stressTest(concurrentRequests = 5) {
    console.log(`\n⚡ Running stress test with ${concurrentRequests} concurrent requests...`);
    
    const promises = [];
    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(this.client.get('/health'));
    }

    try {
      const results = await Promise.all(promises);
      console.log(`✅ All ${concurrentRequests} requests completed successfully`);
      return true;
    } catch (error) {
      console.error('❌ Stress test failed:', error.message);
      return false;
    }
  }
}

// If this file is run directly
if (require.main === module) {
  const port = process.argv[2] || 3000;
  const debugTool = new DebugTool(`http://localhost:${port}`);
  
  // Check if we want to run stress test
  const args = process.argv.slice(2);
  if (args.includes('--stress')) {
    debugTool.stressTest(parseInt(args.find(arg => !arg.startsWith('-')) || 5));
  } else {
    debugTool.runFullDebug();
  }
}

module.exports = DebugTool;