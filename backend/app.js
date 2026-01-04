const express = require('express');
const dotenv = require('dotenv');
const sessionRoutes = require('./routes/sessions'); // Example route

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());

// Routes
app.use('/api/sessions', sessionRoutes); // Example route

// Root Route
app.get('/', (req, res) => {
  res.send('Anonymous Q&A Backend is running!');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});