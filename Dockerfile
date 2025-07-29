FROM node:18

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip

# Set up app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy rest of the project
COPY . .

# Expose the port
EXPOSE 3000

# Start the Node.js app
CMD ["npm", "start"]
