#!/bin/bash

# filepath: create_tables.sh

# Database connection details
DB_HOST="localhost"
DB_PORT="5432"
DB_USER="admin"
DB_NAME="anonqa"

# SQL commands to create tables
SQL=$(cat <<EOF
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  visibility BOOLEAN NOT NULL,
  passcode VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  upvotes INT DEFAULT 0,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
EOF
)

# Execute the SQL commands
echo "Creating tables in the database '$DB_NAME'..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$SQL"

if [ $? -eq 0 ]; then
  echo "Tables created successfully!"
else
  echo "Failed to create tables."
fi