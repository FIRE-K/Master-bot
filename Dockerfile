# Use the official Node.js 18 image as the base
FROM node:18

# Install Python 3, pip, and the venv module
# Note: The node:18 image is typically based on Debian Bookworm, which uses python3.11
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set up the app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on (if needed for health checks)
EXPOSE 3000

# Define the command to run the application
CMD ["npm", "start"]
