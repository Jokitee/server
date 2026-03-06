# Second-hand Book Market API Server

This is an API server for a second-hand book market, providing book posting, searching, user management and other features.

## Features

- User registration and management
- Book posting and management
- Book search and filtering
- Book status management
- Detailed book information display

## Database Structure Optimization

### Users table (users)
- `id`: Primary key, auto-increment integer
- `username`: Username (unique, required)
- `contact_info`: Contact information
- `email`: Email address
- `phone`: Phone number
- `avatar_url`: Avatar URL
- `created_at`: Creation time
- `updated_at`: Update time

### Books table (books)
- `id`: Primary key, auto-increment integer
- `title`: Book title (required)
- `author`: Author
- `isbn`: International Standard Book Number (unique, required)
- `price`: Current selling price
- `original_price`: Original price
- `condition`: Book condition (new, like_new, good, fair, poor, default is good)
- `description`: Description
- `category`: Category
- `image_urls`: Image URL array (JSON format)
- `seller_id`: Seller ID (foreign key)
- `buyer_id`: Buyer ID (foreign key)
- `status`: Status (available, reserved, sold, inactive, default is available)
- `views_count`: View count
- `created_at`: Creation time
- `updated_at`: Update time

## API Endpoints

### Book-related
- `GET /api/books` - Get book list (with search, pagination, filtering)
- `GET /api/books/:id` - Get specific book details
- `POST /api/books` - Post new book
- `PUT /api/books/:id/status` - Update book status

### User-related
- `POST /api/users` - Create new user
- `GET /api/users/:id` - Get user information

### Other
- `GET /health` - Health check
- `GET /` - Root path, return API information

## Search and Filter Parameters

`GET /api/books` supports the following query parameters:
- `search`: Search by title, author or description
- `isbn`: Exact match by ISBN
- `page`: Page number (default 1)
- `limit`: Items per page (default 20, max 100)
- `status`: Filter by status
- `category`: Filter by category
- `condition`: Filter by condition
- `min_price`: Minimum price
- `max_price`: Maximum price
- `sort_by`: Sort field (created_at, updated_at, price, views_count, title)
- `order`: Sort direction (asc, desc)

## Database Optimization

- Created indexes for commonly queried fields
- Added data integrity constraints
- Implemented foreign key relationships
- Supports soft deletion (via status field)

## Installation and Running

```bash
cd server
npm install
npm start
```

The server will run on http://localhost:3000.

## Debugging

Use the debug tool to test the API:

```bash
node debug-tool.js
```

## Database Migration

To update the existing database structure, run:

```bash
node migrate-database.js