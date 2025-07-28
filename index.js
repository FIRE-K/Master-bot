// index.js
const { Telegraf } = require('telegraf');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Store for managed bots
const managedBots = new Map();

// Track which bot the user is about to send requirements for
let awaitingRequirementsFor = null;

// Initialize Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Telegram Master Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bots: Array.from(managedBots.keys()) });
});

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Health check server running on port ${PORT}`);
});

// Initialize Telegraf bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('Please set BOT_TOKEN environment variable');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Command: Start
bot.start((ctx) => {
    const welcomeMessage = `🤖 Welcome to the Telegram Master Bot!

I can manage and run Python bots for you.

Commands:
/upload - Upload a Python bot (.py file)
/uploadreq <bot_name> - Upload requirements.txt for a specific bot
/list - List all managed bots
/startbot <bot_name> - Start a specific bot
/stopbot <bot_name> - Stop a specific bot
/logs <bot_name> - View logs for a specific bot
/help - Show this help message

How to use:
1. Send me your bot's .py file using /upload.
2. (Optional) If your bot needs packages, create a requirements.txt file locally, then use /uploadreq <bot_name> followed by sending the requirements.txt file.
3. Use /startbot <bot_name> to run your bot. I'll install requirements first if provided.
4. Use /stopbot <bot_name> to stop it.
5. Check logs with /logs <bot_name>.`;
    ctx.reply(welcomeMessage);
});

// Command: Help
bot.help((ctx) => {
    const helpMessage = `🤖 Telegram Master Bot - Help

Commands:
/upload - Upload a Python bot (.py file)
/uploadreq <bot_name> - Upload requirements.txt for a specific bot
/list - List all managed bots
/startbot <bot_name> - Start a specific bot
/stopbot <bot_name> - Stop a specific bot
/logs <bot_name> - View logs for a specific bot
/help - Show this help message

Steps:
1. Upload your Python bot script (.py) using /upload.
2. (Optional) If your bot needs external Python packages:
   a. Prepare a requirements.txt file listing the packages (e.g., telegraf==4.12.2).
   b. Use /uploadreq <bot_name> (replace <bot_name> with your bot's name, without .py).
   c. Send the requirements.txt file when prompted.
3. Start your bot using /startbot <bot_name>. The master bot will automatically install packages from requirements.txt (if provided) before starting the script.
4. Stop your bot using /stopbot <bot_name>.
5. View your bot's output/logs using /logs <bot_name>.`;
    ctx.reply(helpMessage);
});

// Command: Upload bot
bot.command('upload', (ctx) => {
    ctx.reply('📁 Please send me your Python bot file (.py) and I\'ll manage it for you!');
});

// Command: Upload requirements
bot.command('uploadreq', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];

    if (!botName) {
        return ctx.reply('⚠️ Usage: /uploadreq <bot_name>\nUse /list to see available bots.');
    }

    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found. Use /list to see available bots.`);
    }

    awaitingRequirementsFor = botName;
    ctx.reply(`✅ Awaiting requirements.txt for bot '${botName}'. Please send the file now.`);
});

// Handle document uploads
bot.on('document', async (ctx) => {
    try {
        const document = ctx.message.document;
        const fileId = document.file_id;
        const fileName = document.file_name;

        // Download file
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await fetch(fileLink);
        const buffer = await response.buffer();

        // Determine file type and handle accordingly
        if (fileName.endsWith('.py')) {
            const botName = fileName.replace('.py', '');
            const filePath = path.join(uploadsDir, fileName);
            const requirementsPath = path.join(uploadsDir, `${botName}_requirements.txt`);

            fs.writeFileSync(filePath, buffer);

            // Store bot info, including path for potential requirements.txt
            managedBots.set(botName, {
                name: botName,
                fileName: fileName,
                filePath: filePath,
                requirementsPath: requirementsPath, // Add requirements path
                process: null,
                logs: [],
                status: 'stopped'
            });

            // Create an empty placeholder requirements.txt
            if (!fs.existsSync(requirementsPath)) {
                fs.writeFileSync(requirementsPath, '');
            }

            awaitingRequirementsFor = null; // Reset state after .py upload
            ctx.reply(`✅ Bot "${botName}" uploaded successfully!\n\nUse /startbot ${botName} to start it.\nUse /uploadreq ${botName} if you need to provide requirements.`);
        } else if (fileName === 'requirements.txt') {
            if (!awaitingRequirementsFor) {
                return ctx.reply('❓ I\'m not expecting a requirements.txt file right now. Use /uploadreq <bot_name> first.');
            }

            const targetBotName = awaitingRequirementsFor;
            const botInfo = managedBots.get(targetBotName);

            if (!botInfo) {
                awaitingRequirementsFor = null;
                return ctx.reply(`❌ Error: Target bot '${targetBotName}' not found for requirements.`);
            }

            // Save requirements.txt to the specific path for this bot
            fs.writeFileSync(botInfo.requirementsPath, buffer);

            awaitingRequirementsFor = null; // Reset state after successful upload
            ctx.reply(`✅ requirements.txt successfully linked to bot "${targetBotName}"!\n\nYou can now start the bot with /startbot ${targetBotName}.`);
        } else {
            return ctx.reply('⚠️ Please upload only Python files (.py) or a requirements.txt file (after using /uploadreq <bot_name>).');
        }

    } catch (error) {
        console.error('Upload error:', error);
        awaitingRequirementsFor = null; // Reset state on error
        ctx.reply('❌ Error uploading file. Please try again.');
    }
});


// Command: List bots
bot.command('list', (ctx) => {
    if (managedBots.size === 0) {
        return ctx.reply('📭 No bots uploaded yet. Use /upload to add bots.');
    }

    let message = '🤖 Managed Bots:\n\n';
    managedBots.forEach((botInfo, botName) => {
        message += `🔹 ${botName} - Status: ${botInfo.status.toUpperCase()}\n`;
    });

    ctx.reply(message);
});

// --- Helper Function for Pip Install ---
function installRequirements(requirementsPath, botName) { // Added botName for logging
    return new Promise((resolve, reject) => {
        // Check if file exists and is not empty
        if (!fs.existsSync(requirementsPath)) {
             console.log(`[StartBot: ${botName}] Requirements file not found: ${requirementsPath}`);
             resolve(); // Resolve if no requirements file, meaning nothing to install
             return;
        }
        const stats = fs.statSync(requirementsPath);
        if (stats.size === 0) {
             console.log(`[StartBot: ${botName}] Requirements file is empty: ${requirementsPath}`);
             resolve(); // Resolve if empty, meaning nothing to install
             return;
        }

        console.log(`[StartBot: ${botName}] Installing requirements from: ${requirementsPath}`);
        // Use 'pip3' for clarity, and quote the path in case of spaces
        const pipProcess = exec(`pip3 install -r "${requirementsPath}"`, { cwd: uploadsDir });

        let stdoutData = '';
        let stderrData = '';

        pipProcess.stdout.on('data', (data) => {
            stdoutData += data.toString();
            console.log(`[StartBot: ${botName}] [pip install stdout] ${data.toString()}`);
        });

        pipProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
            console.error(`[StartBot: ${botName}] [pip install stderr] ${data.toString()}`);
        });

        pipProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`[StartBot: ${botName}] Successfully installed packages from ${requirementsPath}`);
                resolve(stdoutData); // Resolve with stdout on success
            } else {
                console.error(`[StartBot: ${botName}] Failed to install packages from ${requirementsPath}. Exit code: ${code}`);
                // Include stderr in the rejection for better error reporting
                reject(new Error(`pip install failed with exit code ${code}\nStderr:\n${stderrData}`));
            }
        });

        pipProcess.on('error', (error) => {
            console.error(`[StartBot: ${botName}] Error spawning pip install process:`, error);
            reject(error);
        });
    });
}
// --- End Helper Function ---

// Command: Start bot
bot.command('startbot', async (ctx) => { // Make function async
    const botName = ctx.message.text.split(' ')[1];

    if (!botName) {
        return ctx.reply('⚠️ Usage: /startbot <bot_name>\nUse /list to see available bots.');
    }

    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found. Use /list to see available bots.`);
    }

    if (botInfo.status === 'running') {
        return ctx.reply(`ℹ️ Bot "${botName}" is already running.`);
    }

    try {
        // --- Install Requirements First ---
        const installingMsg = await ctx.reply(`⏳ Installing requirements for "${botName}" (if any)...`);
        try {
            await installRequirements(botInfo.requirementsPath, botName); // Wait for pip install, pass botName
            // Edit the previous message instead of sending a new one
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `✅ Requirements installed (or none found) for "${botName}".`);
        } catch (installError) {
            console.error(`[StartBot] Error installing requirements for ${botName}:`, installError);
            // Send detailed error to user (be cautious with exposing internal errors)
            const errorMessage = installError.message.length > 300 ?
                installError.message.substring(0, 300) + '... (truncated)' :
                installError.message;
            // Edit the previous message to show the error
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `❌ Failed to install requirements for "${botName}". Bot not started.\nError: ${errorMessage}`);
            return; // Stop the start process if install failed
        }
        // --- End Install Requirements ---

        // Start the Python bot
        console.log(`[StartBot: ${botName}] Starting Python bot: ${botInfo.filePath}`);
        const pythonProcess = spawn('python3', [botInfo.filePath], {
            cwd: uploadsDir
        });

        botInfo.process = pythonProcess;
        botInfo.status = 'running';
        botInfo.logs = []; // Clear previous logs

        // Capture stdout
        pythonProcess.stdout.on('data', (data) => {
            const log = data.toString();
            botInfo.logs.push(`[STDOUT] ${log}`);
            console.log(`[${botName}] ${log}`);
        });

        // Capture stderr
        pythonProcess.stderr.on('data', (data) => {
            const log = data.toString();
            botInfo.logs.push(`[STDERR] ${log}`);
            console.error(`[${botName}] ${log}`);
        });

        // Handle process exit
        pythonProcess.on('close', (code) => {
            botInfo.status = 'stopped';
            botInfo.process = null;
            botInfo.logs.push(`[EXIT] Process exited with code ${code}`);
            console.log(`[${botName}] Process exited with code ${code}`);
        });

        ctx.reply(`🚀 Bot "${botName}" started successfully!`);
    } catch (error) {
        console.error('[StartBot] Unexpected error:', error);
        ctx.reply(`❌ Error starting bot "${botName}".`);
    }
});

// Command: Stop bot
bot.command('stopbot', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];

    if (!botName) {
        return ctx.reply('⚠️ Usage: /stopbot <bot_name>\nUse /list to see available bots.');
    }

    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }

    if (botInfo.status === 'stopped') {
        return ctx.reply(`ℹ️ Bot "${botName}" is already stopped.`);
    }

    try {
        if (botInfo.process) {
            botInfo.process.kill('SIGTERM'); // Use SIGTERM for graceful shutdown
            botInfo.process = null;
        }
        botInfo.status = 'stopped';
        ctx.reply(`⏹️ Bot "${botName}" stopped successfully!`);
    } catch (error) {
        console.error('[StopBot] Error:', error);
        ctx.reply(`❌ Error stopping bot "${botName}".`);
    }
});

// Command: View logs
bot.command('logs', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];

    if (!botName) {
        return ctx.reply('⚠️ Usage: /logs <bot_name>\nUse /list to see available bots.');
    }

    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }

    if (botInfo.logs.length === 0) {
        return ctx.reply(`📭 No logs available for "${botName}".`);
    }

    // Get last 25 logs for potentially longer output
    const recentLogs = botInfo.logs.slice(-25);
    let message = `📋 Logs for ${botName}:\n\n`;
    message += recentLogs.join('\n');

    // Split very long messages if necessary
    if (message.length > 4000) {
        message = message.substring(0, 4000) + '\n... (truncated)';
    }

    ctx.reply(message);
});

// Error handling for the bot itself
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('❌ An unexpected error occurred in the master bot. Please try your command again.');
});

// Start the bot
bot.launch();

console.log('🚀 Telegram Master Bot started!');

// Graceful shutdown for the master bot process
process.once('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    bot.stop('SIGTERM');
    process.exit(0);
});
