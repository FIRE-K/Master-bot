// index.js
const { Telegraf, Markup } = require('telegraf'); // Import Markup for buttons
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip'); // Add this for zip handling
const express = require('express');

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Store for managed bots
const managedBots = new Map();

// Track state for multi-step interactions
const userStates = {}; // userId -> { step: '...',  {...} }

// Track bots waiting for user input
// Maps chatId -> { botName: string, process: ChildProcess, prompt: string, timeoutId: NodeJS.Timeout }
const botsAwaitingInput = new Map();

// Timeout for input requests (e.g., 5 minutes)
const INPUT_TIMEOUT_MS = 5 * 60 * 1000;

// Initialize Express app for health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('MASTER Bot is running!');
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
    // This is a critical startup error, cannot send to Telegram
    console.error('Please set BOT_TOKEN environment variable');
    process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

// --- Helper Function for Pip Install using Virtual Environment ---
function installRequirements(requirementsPath, botName) {
    return new Promise(async (resolve, reject) => {
        // --- 1. Determine paths ---
        const venvDir = path.join(uploadsDir, `${botName}_venv`);
        const venvPipPath = path.join(venvDir, 'bin', 'pip'); // Linux/macOS path
        // const venvPipPath = path.join(venvDir, 'Scripts', 'pip.exe'); // Windows path (if needed)
        const venvPythonPath = path.join(venvDir, 'bin', 'python'); // Linux/macOS path
        // const venvPythonPath = path.join(venvDir, 'Scripts', 'python.exe'); // Windows path (if needed)

        if (!fs.existsSync(requirementsPath)) {
            console.log(`[StartBot: ${botName}] Requirements file not found or empty: ${requirementsPath}`);
            resolve({ venvPythonPath }); // Resolve with venv path info
            return;
        }
        const stats = fs.statSync(requirementsPath);
        if (stats.size === 0) {
            console.log(`[StartBot: ${botName}] Requirements file is empty: ${requirementsPath}`);
            resolve({ venvPythonPath }); // Resolve with venv path info
            return;
        }

        try {
            // --- 2. Create Virtual Environment (if it doesn't exist) ---
            if (!fs.existsSync(venvDir)) {
                console.log(`[StartBot: ${botName}] Creating virtual environment at: ${venvDir}`);
                const createVenvProcess = exec(`python3 -m venv "${venvDir}"`, { cwd: uploadsDir });
                let createStdout = '';
                let createStderr = '';
                createVenvProcess.stdout.on('data', (data) => {
                    createStdout += data.toString();
                    console.log(`[StartBot: ${botName}] [venv create stdout] ${data.toString()}`);
                });
                createVenvProcess.stderr.on('data', (data) => {
                    createStderr += data.toString();
                    console.error(`[StartBot: ${botName}] [venv create stderr] ${data.toString()}`);
                });
                await new Promise((res, rej) => {
                    createVenvProcess.on('close', (code) => {
                        if (code === 0) {
                            console.log(`[StartBot: ${botName}] Successfully created virtual environment.`);
                            res();
                        } else {
                            console.error(`[StartBot: ${botName}] Failed to create virtual environment. Exit code: ${code}`);
                            rej(new Error(`venv create failed with exit code ${code}
Stderr:
${createStderr}`));
                        }
                    });
                    createVenvProcess.on('error', (error) => {
                        console.error(`[StartBot: ${botName}] Error creating virtual environment:`, error);
                        rej(error);
                    });
                });
            } else {
                console.log(`[StartBot: ${botName}] Virtual environment already exists at: ${venvDir}`);
            }

            // --- 3. Upgrade pip within the venv (good practice) ---
            console.log(`[StartBot: ${botName}] Upgrading pip in virtual environment...`);
            const upgradePipProcess = exec(`"${venvPipPath}" install --upgrade pip`, { cwd: uploadsDir });
            let upgradeStdout = '';
            let upgradeStderr = '';
            upgradePipProcess.stdout.on('data', (data) => {
                 upgradeStdout += data.toString();
                 console.log(`[StartBot: ${botName}] [pip upgrade stdout] ${data.toString()}`);
            });
            upgradePipProcess.stderr.on('data', (data) => {
                 upgradeStderr += data.toString();
                 console.error(`[StartBot: ${botName}] [pip upgrade stderr] ${data.toString()}`);
            });
            await new Promise((res, rej) => {
                 upgradePipProcess.on('close', (code) => {
                     if (code === 0) {
                         console.log(`[StartBot: ${botName}] Successfully upgraded pip in virtual environment.`);
                         res();
                     } else {
                         console.error(`[StartBot: ${botName}] Failed to upgrade pip in virtual environment. Exit code: ${code}`);
                         rej(new Error(`pip upgrade failed with exit code ${code}
Stderr:
${upgradeStderr}`));
                     }
                 });
                 upgradePipProcess.on('error', (error) => {
                     console.error(`[StartBot: ${botName}] Error upgrading pip in virtual environment:`, error);
                     rej(error);
                 });
            });

            // --- 4. Install Requirements using venv pip ---
            console.log(`[StartBot: ${botName}] Installing requirements from: ${requirementsPath} into venv: ${venvDir}`);
            const pipProcess = exec(`"${venvPipPath}" install -r "${requirementsPath}"`, { cwd: uploadsDir });
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
                    console.log(`[StartBot: ${botName}] Successfully installed packages from ${requirementsPath} into venv.`);
                    resolve({ venvPythonPath }); // Resolve with the path to the venv's Python
                } else {
                    console.error(`[StartBot: ${botName}] Failed to install packages from ${requirementsPath} into venv. Exit code: ${code}`);
                    reject(new Error(`pip install failed with exit code ${code}
Stderr:
${stderrData}`));
                }
            });
            pipProcess.on('error', (error) => {
                console.error(`[StartBot: ${botName}] Error spawning pip install process in venv:`, error);
                reject(error);
            });
        } catch (error) {
            console.error(`[StartBot: ${botName}] Unexpected error during venv setup/install:`, error);
            reject(error);
        }
    });
}
// --- End Helper Function ---

// --- State Management Helpers ---
function setUserState(userId, step, data = {}) {
    userStates[userId] = { step, data };
}

function getUserState(userId) {
    return userStates[userId];
}

function clearUserState(userId) {
    delete userStates[userId];
}
// --- End State Management Helpers ---

// --- Helper to Stop a Bot (for deletion/editing/stopping) ---
async function stopBot(botName, signal = 'SIGTERM') {
    const botInfo = managedBots.get(botName);
    if (botInfo && botInfo.status === 'running' && botInfo.process) {
        try {
            botInfo.process.kill(signal);
            botInfo.process = null;
        } catch (error) {
            console.error(`[StopBotHelper] Error killing process for ${botName}:`, error);
            // Continue with potential deletion/editing even if kill fails
        }
    }
    if (botInfo) {
        botInfo.status = 'stopped';
    }
    // Also clear any pending input state for this bot
    for (const [chatId, inputData] of botsAwaitingInput.entries()) {
        if (inputData.botName === botName) {
            clearTimeout(inputData.timeoutId);
            botsAwaitingInput.delete(chatId);
            // Optionally notify user input was cancelled due to stop
            // await bot.telegram.sendMessage(chatId, `⚠️ Input request for bot "${botName}" was cancelled because the bot stopped.`);
        }
    }
}
// --- End Helper to Stop a Bot ---

// --- Helper for Input Timeout ---
function setInputTimeout(chatId, botName, prompt) {
   const timeoutId = setTimeout(() => {
       const inputData = botsAwaitingInput.get(chatId);
       if (inputData && inputData.botName === botName) { // Double-check it's still the same request
            botsAwaitingInput.delete(chatId);
            // Send timeout message to user
            bot.telegram.sendMessage(chatId, `⏰ Input request timed out for bot "${botName}". Prompt was: ${prompt}`);
       }
   }, INPUT_TIMEOUT_MS);
   return timeoutId;
}
// --- End Helper for Input Timeout ---

// --- Helper Function: Find Python Files ---
function findPythonFiles(dir, fileList = [], baseDir = dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            // Recurse into subdirectories
            findPythonFiles(filePath, fileList, baseDir);
        } else if (file.endsWith('.py')) {
            // Calculate the relative path from the base directory
            const relativePath = path.relative(baseDir, filePath);
            fileList.push(relativePath);
        }
    });
    return fileList;
}
// --- End Helper Function: Find Python Files ---

// Command: Start
bot.start((ctx) => {
    const welcomeMessage = `🤖 Welcome to the MASTER Bot!
I can manage and run Python bots for you. View /help for more.
Get started by using /create_bot <your_bot_name>!`;
    ctx.reply(welcomeMessage);
});

// Command: Help
bot.help((ctx) => {
    const helpMessage = `🤖 MASTER Bot - Help
Commands:
/create_bot <name> - Initiates the process to add a new Python bot with the given name.
/edit_bot <name> - Asks how to provide new code, then shows current code.
/delete_bot <name> - Deletes a bot. It will be stopped if currently running.
/run_bot <name> - Starts a specific bot (installs requirements if provided). Supports print/input!
/stop_bot <name> - Stops a running bot.
/status [<name>] - Shows the status of a specific bot or all bots.
/list_bots - Lists all bots managed by this MASTER bot.
/req <name> - Initiates the process to add requirements for an existing bot.
/source <name> - Sends the source code and requirements for a bot as files.
/logs <name> - Displays the last logs for a bot.
/help - Shows this help message.
Steps to add a bot:
1. Use /create_bot <unique_bot_name>.
2. Choose whether to upload a .py file, paste code directly, or upload a .zip project.
3. (Optional) Later, use /req <bot_name> to provide requirements (upload file or paste text).
4. Run your bot with /run_bot <bot_name>.`;
    ctx.reply(helpMessage);
});

// Command: List Bots
bot.command('list_bots', (ctx) => {
    const botNames = Array.from(managedBots.keys());
    if (botNames.length === 0) {
        return ctx.reply("📭 No bots are currently managed. Use /create_bot to add one!");
    }
    let message = "🤖 Managed Bots:
";
    botNames.forEach(name => {
        message += `- ${name}
`;
    });
    ctx.reply(message);
});

// Command: Status
bot.command('status', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];
    if (botName) {
        // Check specific bot
        const botInfo = managedBots.get(botName);
        if (!botInfo) {
           return ctx.reply(`❌ Bot "${botName}" not found.`);
        }
        ctx.reply(`📊 Status for bot "${botName}": *${botInfo.status.toUpperCase()}*`, { parse_mode: 'Markdown' });
    } else {
        // Show status for all bots
        const botNames = Array.from(managedBots.keys());
        if (botNames.length === 0) {
            return ctx.reply("📭 No bots are currently managed. Use /create_bot to add one!");
        }
        let message = "📊 Status for all bots:
";
        botNames.forEach(name => {
            const status = managedBots.get(name).status;
            message += `- ${name}: *${status.toUpperCase()}*
`;
        });
        ctx.reply(message, { parse_mode: 'Markdown' });
    }
});

// --- Modified Command: create_bot ---
bot.command('create_bot', (ctx) => {
    const userId = ctx.from.id;
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /create_bot <bot_name>');
    }
    const sanitizedBotName = botName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (managedBots.has(sanitizedBotName)) {
        return ctx.reply(`❌ A bot named "${sanitizedBotName}" already exists. Please choose a different name.`);
    }

    // Set initial state to choose the method of providing the bot
    setUserState(userId, 'AWAITING_BOT_CREATION_METHOD', { botName: sanitizedBotName });

    ctx.reply(`📝 How would you like to provide the code/project for "${sanitizedBotName}"?`,
        Markup.inlineKeyboard([
            Markup.button.callback('✏️ Paste Code Text', 'paste_code'),
            Markup.button.callback('📤 Upload Single .py File', 'upload_file'),
            Markup.button.callback('📦 Upload .zip Project', 'upload_zip_project')
        ])
    );
});
// --- End Modified Command: create_bot ---

// --- Modified Command: Run bot ---
bot.command('run_bot', async (ctx) => {
    const chatId = ctx.chat.id;
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /run_bot <bot_name>');
    }
    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }
    // Use mainScriptPath instead of assuming fileName
    const mainScriptPath = botInfo.mainScriptPath;
    if (!mainScriptPath || !fs.existsSync(mainScriptPath)) {
         return ctx.reply(`❌ Main script for bot "${botName}" not found or path invalid.`);
    }
    if (botInfo.status === 'running') {
        return ctx.reply(`ℹ️ Bot "${botName}" is already running.`);
    }
    try {
        const installingMsg = await ctx.reply(`⏳ Installing requirements for "${botName}" (if any)...`);
        let venvPythonPathForBot = 'python3'; // Default fallback
        try {
            // Pass the requirementsPath from botInfo
            const installResult = await installRequirements(botInfo.requirementsPath, botName);
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `✅ Requirements installed (or none found) for "${botName}".`);
            if (installResult && installResult.venvPythonPath) {
                venvPythonPathForBot = installResult.venvPythonPath;
            }
        } catch (installError) {
            console.error(`[RunBot] Error installing requirements for ${botName}:`, installError);
            const errorMessage = installError.message.length > 300 ?
                installError.message.substring(0, 300) + '... (truncated)' :
                installError.message;
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `❌ Failed to install requirements for "${botName}". Bot not run.
Error: ${errorMessage}`);
            return;
        }

        // Use mainScriptPath for running
        console.log(`[RunBot: ${botName}] Running Python script: ${mainScriptPath} using Python: ${venvPythonPathForBot}`);
        // const fullPath = path.resolve(uploadsDir, botInfo.fileName); // OLD
        const fullPath = path.resolve(mainScriptPath); // NEW: Use the stored main script path

        const pythonProcess = spawn(venvPythonPathForBot, [fullPath], {
            cwd: path.dirname(fullPath), // Set working directory to the script's directory
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // --- Enhanced Error Handling and I/O (Keep existing logic) ---
        let errorDetected = false;
        let errorOutput = "";
        const maxErrorOutputLength = 3500;
        botInfo.process = pythonProcess;
        botInfo.status = 'running';
        botInfo.logs = [];
        let stdoutBuffer = '';

        pythonProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            botInfo.logs.push(`[STDOUT] ${chunk}`);
            console.log(`[${botName}] [STDOUT] ${chunk}`);
            stdoutBuffer += chunk;
            // Process complete lines
            let lines = stdoutBuffer.split('
');
            // Keep the last potentially incomplete line in the buffer
            stdoutBuffer = lines.pop();
            // Send complete lines to user
            lines.forEach(line => {
                if (line.trim() !== '') { // Avoid sending empty lines
                    ctx.reply(`\`${botName}\` >> ${line}`, { parse_mode: 'Markdown' });
                }
            });
            // Check if the remaining buffer (potentially incomplete line) looks like a prompt
            // Heuristic: Ends with a common prompt character and no trailing newline
            if (stdoutBuffer && /[:?]$/.test(stdoutBuffer.trim())) {
                 // Looks like a prompt, wait for user input
                 // Clear any existing input request for this chat
                 const existingRequest = botsAwaitingInput.get(chatId);
                 if (existingRequest) {
                     clearTimeout(existingRequest.timeoutId);
                 }
                 const timeoutId = setInputTimeout(chatId, botName, stdoutBuffer);
                 botsAwaitingInput.set(chatId, { botName, process: pythonProcess, prompt: stdoutBuffer, timeoutId });
                 ctx.reply(`\`${botName}\` [INPUT] >> ${stdoutBuffer}`, { parse_mode: 'Markdown' });
                 stdoutBuffer = ''; // Clear buffer after treating as prompt
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            const log = data.toString();
            botInfo.logs.push(`[STDERR] ${log}`);
            console.error(`[${botName}] [STDERR] ${log}`);
            // Detect potential errors (basic heuristic)
            if (!errorDetected && (log.toLowerCase().includes('error') || log.toLowerCase().includes('exception') || log.toLowerCase().includes('traceback'))) {
                errorDetected = true;
            }
            // Accumulate error output for reporting
            if (errorDetected) {
                 errorOutput += log;
                 if (errorOutput.length > maxErrorOutputLength * 2) { // Stop accumulating if too large
                      errorOutput = errorOutput.substring(0, maxErrorOutputLength) + "
... (Error output truncated)...";
                 }
            }
        });

        pythonProcess.on('close', (code, signal) => {
            // Flush any remaining stdout buffer
            if (stdoutBuffer && stdoutBuffer.trim() !== '') {
                ctx.reply(`\`${botName}\` >> ${stdoutBuffer}`, { parse_mode: 'Markdown' });
            }
            stdoutBuffer = ''; // Clear buffer
            const exitLog = `[EXIT] Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
            botInfo.logs.push(exitLog);
            console.log(`[${botName}] ${exitLog}`);
            botInfo.status = 'stopped';
            botInfo.process = null;
            // Clear any pending input state for this bot/chat
            if (botsAwaitingInput.get(chatId)?.botName === botName) {
                const inputData = botsAwaitingInput.get(chatId);
                clearTimeout(inputData.timeoutId);
                botsAwaitingInput.delete(chatId);
            }
            // Determine final message based on exit code and errors detected
            if (code === 0) {
                // Normal exit
                ctx.reply(`✅ Bot "${botName}" finished running normally.`);
            } else if (code === null && signal) {
                // Killed by signal (e.g., SIGTERM from /stop_bot)
                if (signal === 'SIGTERM') {
                   ctx.reply(`⏹️ Bot "${botName}" was stopped successfully.`);
                } else {
                   ctx.reply(`⚠️ Bot "${botName}" was terminated by signal: ${signal}`);
                }
            } else {
                // Non-zero exit code or error detected via stderr
                let errorMsg = `⚠️ Bot "${botName}" stopped`;
                if (code !== null) {
                    errorMsg += ` with exit code ${code}`;
                }
                if (signal) {
                    errorMsg += ` (signal: ${signal})`;
                }
                errorMsg += '.';
                if (errorDetected && errorOutput.trim() !== "") {
                    errorMsg += `
Potential error detected in your bot's code:
\`\`\`
${errorOutput.substring(0, maxErrorOutputLength)}${errorOutput.length > maxErrorOutputLength ? '
... (truncated)' : ''}
\`\`\``;
                    ctx.reply(errorMsg, { parse_mode: 'Markdown' });
                } else if (code !== 0) {
                    // Non-zero exit without obvious stderr error message
                    errorMsg += " Check /logs for details.";
                    ctx.reply(errorMsg);
                } else {
                    // Shouldn't usually happen with code 0 and errorDetected, but just in case
                    ctx.reply(errorMsg);
                }
            }
        });

        pythonProcess.on('error', (error) => {
            console.error(`[RunBot] Error spawning process for bot "${botName}":`, error);
            botInfo.status = 'stopped';
            botInfo.process = null;
            botInfo.logs.push(`[SPAWN ERROR] ${error.message}`);
            ctx.reply(`❌ Failed to start bot "${botName}". Error: ${error.message}`);
        });
        // --- End Enhanced Error Handling ---

        ctx.reply(`🚀 Bot "${botName}" (script: ${path.basename(mainScriptPath)}) started successfully!`);
    } catch (error) {
        console.error('[RunBot] Unexpected error:', error);
        ctx.reply(`❌ Error running bot "${botName}": ${error.message}`);
    }
});
// --- End Modified Command: Run bot ---

// Command: Stop bot
bot.command('stop_bot', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /stop_bot <bot_name>');
    }
    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }
    if (botInfo.status === 'stopped') {
        return ctx.reply(`ℹ️ Bot "${botName}" is already stopped.`);
    }
    try {
        // stopBot helper now handles process killing and clearing input state
        stopBot(botName, 'SIGTERM');
        // Send immediate feedback.
        ctx.reply(`⏹️ Stopping bot "${botName}"...`);
    } catch (error) {
        console.error('[StopBot] Error:', error);
        ctx.reply(`❌ Error stopping bot "${botName}": ${error.message}`);
    }
});

// Command: View logs
bot.command('logs', (ctx) => {
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /logs <bot_name>');
    }
    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }
    if (botInfo.logs.length === 0) {
        return ctx.reply(`📭 No logs available for "${botName}".`);
    }
    const recentLogs = botInfo.logs.slice(-25);
    let message = `📋 Logs for ${botName}:
`;
    message += recentLogs.join('
');
    if (message.length > 4000) {
        message = message.substring(0, 4000) + '
... (truncated)';
    }
    ctx.reply(message);
});

// --- Modified Command: delete_bot ---
bot.command('delete_bot', async (ctx) => {
    const targetBotName = ctx.message.text.split(' ')[1];
    if (!targetBotName) {
        return ctx.reply('⚠️ Usage: /delete_bot <bot_name>');
    }
    const botInfo = managedBots.get(targetBotName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${targetBotName}" not found.`);
    }
    try {
        await stopBot(targetBotName); // Stop if running

        // Delete the entire virtual environment directory
        const venvDirToDelete = path.join(uploadsDir, `${targetBotName}_venv`);
        if (fs.existsSync(venvDirToDelete)) {
            try {
                fs.rmSync(venvDirToDelete, { recursive: true, force: true });
                console.log(`[DeleteBot] Deleted virtual environment/project directory: ${venvDirToDelete}`);
            } catch (venvError) {
                console.error(`[DeleteBot] Error deleting virtual environment ${venvDirToDelete}:`, venvError);
                await ctx.reply(`⚠️ Bot "${targetBotName}" entry removed, but there was an error deleting its project directory: ${venvError.message}`);
            }
        } else {
            // If venv dir doesn't exist, try deleting old-style files (fallback)
             try {
                 if (fs.existsSync(botInfo.filePath)) { // filePath might be undefined now, but check old structure
                     fs.unlinkSync(botInfo.filePath);
                     console.log(`[DeleteBot] Deleted old-style bot file: ${botInfo.filePath}`);
                 }
                 if (fs.existsSync(botInfo.requirementsPath)) { // requirementsPath might be inside venv now
                     fs.unlinkSync(botInfo.requirementsPath);
                     console.log(`[DeleteBot] Deleted old-style requirements file: ${botInfo.requirementsPath}`);
                 }
             } catch (fileError) {
                  console.error(`[DeleteBot] Error deleting old-style files for ${targetBotName}:`, fileError);
                  // Inform user about file deletion failure, but continue removing from map
                  await ctx.reply(`⚠️ Bot "${targetBotName}" entry removed, but there was an error deleting some old files: ${fileError.message}`);
             }
        }

        managedBots.delete(targetBotName);
        console.log(`[DeleteBot] Bot "${targetBotName}" deleted.`);
        ctx.reply(`✅ Bot "${targetBotName}" and its project directory have been deleted.`);
    } catch (error) {
        console.error(`[DeleteBot] Error deleting bot ${targetBotName}:`, error);
        ctx.reply(`❌ An error occurred while deleting bot "${targetBotName}": ${error.message}`);
    }
});
// --- End Modified Command: delete_bot ---

// --- NEW COMMAND: /source <bot> (Send as Files) ---
bot.command('source', async (ctx) => {
    const targetBotName = ctx.message.text.split(' ')[1];
    if (!targetBotName) {
        return ctx.reply('⚠️ Usage: /source <bot_name>');
    }
    const botInfo = managedBots.get(targetBotName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${targetBotName}" not found.`);
    }

    const projectDir = botInfo.projectDir;
    if (!projectDir || !fs.existsSync(projectDir)) {
         return ctx.reply(`❌ Project directory for bot "${targetBotName}" not found.`);
    }

    // Option 1: List files (simpler)
    try {
        const files = fs.readdirSync(projectDir);
        if (files.length === 0) {
             return ctx.reply(`📭 Project directory for "${targetBotName}" is empty.`);
        }
        let message = `📁 Files in project for "${targetBotName}":
`;
        files.forEach(file => {
            message += `- ${file}
`;
        });
        ctx.reply(message);
    } catch (readDirError) {
        console.error(`[Source] Error reading project directory for ${targetBotName}:`, readDirError);
        ctx.reply(`❌ Error listing project files for "${targetBotName}": ${readDirError.message}`);
    }

    // Option 2: Send as Zip (more complex, requires creating zip in memory or temp file)
    // This would involve using AdmZip again to create an archive and send it.
    // Consider if this is necessary immediately.

});
// --- End Modified Command: source ---

// --- NEW COMMAND: /edit_bot <bot> (Ask how first, then show current) ---
bot.command('edit_bot', async (ctx) => {
    const userId = ctx.from.id;
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /edit_bot <bot_name>');
    }
    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }
    // 1. Ask how to provide new source FIRST
    setUserState(userId, 'AWAITING_EDIT_BOT_SOURCE', { botName: botName });
    await ctx.reply(`📝 How would you like to provide the NEW code for "${botName}"?`,
        Markup.inlineKeyboard([
            Markup.button.callback('📤 Upload New .py File', 'upload_file_edit'),
            Markup.button.callback('✏️ Paste New Code Text', 'paste_code_edit')
        ])
    );
    // 2. Send current source code file AFTER asking
    try {
        if (fs.existsSync(botInfo.filePath)) {
            await ctx.replyWithDocument({ source: botInfo.filePath }, {
                caption: `📄 *(For reference)* Current code for bot: ${botName}`,
                parse_mode: 'Markdown'
            });
            console.log(`[EditBot] Sent current code file for ${botName} (after asking)`);
        } else {
             // Less likely to happen, but possible
             await ctx.reply(`📝 *(For reference)* No current Python code file found for bot "${botName}".`, { parse_mode: 'Markdown' });
        }
    } catch (sendError) {
        console.error(`[EditBot] Error sending current code file for ${botName}:`, sendError);
        // Don't block the flow, just inform
        await ctx.reply(`⚠️ *(For reference)* Could not display current code for "${botName}". You can still edit it:
${sendError.message}`, { parse_mode: 'Markdown' });
    }
});
// --- End NEW COMMAND: /edit_bot <bot> ---

bot.command('req', (ctx) => {
    const userId = ctx.from.id;
    const targetBotName = ctx.message.text.split(' ')[1];
    if (!targetBotName) {
        return ctx.reply('⚠️ Usage: /req <bot_name>');
    }
    const botInfo = managedBots.get(targetBotName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${targetBotName}" not found.`);
    }
    setUserState(userId, 'AWAITING_REQ_SOURCE', { botName: targetBotName });
    ctx.reply(`📝 How would you like to provide the requirements for "${targetBotName}"?`,
        Markup.inlineKeyboard([
            Markup.button.callback('📤 Upload requirements.txt File', 'upload_req_file'),
            Markup.button.callback('✏️ Paste Requirements Text', 'paste_req_text')
        ])
    );
});

// Error handling for the bot itself (catches errors in middleware/handlers)
bot.catch((err, ctx) => {
    console.error('Bot error:', err); // Always log to console for debugging
    // Clear user state on bot error to prevent getting stuck
    clearUserState(ctx.from.id);
    // Send a generic error message to the user
    ctx.reply('❌ An unexpected error occurred in the master bot. Please try your command again.');
});

// --- Modified Handle text input ---
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getUserState(userId);
    const messageText = ctx.message.text.trim();

    // --- 1. Handle Input for Running Bots ---
    // (Keep your existing logic for handling input to running bots)
    const inputData = botsAwaitingInput.get(chatId);
    if (inputData) {
        // ... existing input logic ...
        // A bot is waiting for input from this chat
        const { botName, process, prompt, timeoutId } = inputData;
        clearTimeout(timeoutId); // Clear the timeout as input is received
        botsAwaitingInput.delete(chatId); // Remove from awaiting list
        try {
            // Send the user's message as input to the bot's stdin
            if (process.stdin.writable) {
                process.stdin.write(messageText + '
');
                console.log(`[INPUT] Sent input "${messageText}" to bot "${botName}"`);
                // Optionally confirm receipt
                // ctx.reply(`✅ Input sent to "${botName}".`);
            } else {
                console.warn(`[INPUT] stdin for bot "${botName}" is not writable.`);
                ctx.reply(`⚠️ Could not send input to bot "${botName}", its input stream seems closed.`);
            }
        } catch (inputError) {
            console.error(`[INPUT] Error sending input to bot "${botName}":`, inputError);
            ctx.reply(`❌ Error sending input to bot "${botName}": ${inputError.message}`);
        }
        return; // Handled as bot input
    }

    // --- 2. Handle Multi-step State Interactions ---
    if (!state) {
        // If user sends text outside a flow, just acknowledge or ignore
        return;
    }

    // --- Handle starting or continuing multi-message code paste ---
    if (state.step === 'AWAITING_CODE_PASTE_START' || state.step === 'AWAITING_CODE_PASTE_CONTINUE') {
        const botName = state.data.botName;

        // Check for the special command to finish pasting
        if (messageText === '/code_done') {
            // User has finished pasting. Proceed to create the bot structure.
            const codeBuffer = state.data.codeBuffer || '';
            if (!codeBuffer) {
                 clearUserState(userId);
                 return ctx.reply(`⚠️ No code was received. Bot creation for "${botName}" cancelled.`);
            }

            try {
                // 1. Create venv (using the helper, even if no requirements.txt yet)
                const venvDir = path.join(uploadsDir, `${botName}_venv`);
                const requirementsPath = path.join(venvDir, 'requirements.txt'); // Standard location inside venv dir
                const projectDir = venvDir; // The project lives inside the venv dir

                if (!fs.existsSync(venvDir)) {
                    console.log(`[CreateBotPaste] Creating virtual environment at: ${venvDir}`);
                    const createVenvProcess = exec(`python3 -m venv "${venvDir}"`, { cwd: __dirname });
                    await new Promise((res, rej) => {
                        createVenvProcess.on('close', (code) => {
                            if (code === 0) {
                                console.log(`[CreateBotPaste] Successfully created virtual environment.`);
                                res();
                            } else {
                                rej(new Error(`venv create failed with exit code ${code}`));
                            }
                        });
                        createVenvProcess.on('error', rej);
                    });
                }

                // 2. Write the pasted code to a default file inside the venv/project dir
                const defaultFileName = `${botName}.py`;
                const defaultFilePath = path.join(projectDir, defaultFileName);
                fs.writeFileSync(defaultFilePath, codeBuffer);
                console.log(`[CreateBotPaste] Pasted code saved to ${defaultFilePath}`);

                // 3. Find all .py files in the project directory for script selection
                const pythonFiles = findPythonFiles(projectDir);

                if (pythonFiles.length === 0) {
                    // Shouldn't happen if we just wrote one, but be safe
                    clearUserState(userId);
                    return ctx.reply(`❌ No Python files found in the project. Bot creation failed.`);
                } else if (pythonFiles.length === 1) {
                    // Only one .py file, auto-select it
                    const selectedScriptPath = path.join(projectDir, pythonFiles[0]);
                    managedBots.set(botName, {
                        name: botName,
                        projectDir: projectDir, // Store the project directory
                        mainScriptPath: selectedScriptPath, // Store the main script path
                        requirementsPath: requirementsPath, // Path inside venv
                        process: null,
                        logs: [],
                        status: 'stopped'
                    });
                    clearUserState(userId);
                    await ctx.reply(`✅ Bot "${botName}" created successfully with main script "${pythonFiles[0]}"!
You can now:
- Use /run_bot ${botName} to run it.
- Use /req ${botName} to provide requirements.`);
                } else {
                    // Multiple .py files, ask user to choose
                    setUserState(userId, 'AWAITING_SCRIPT_SELECTION', { botName, projectDir });
                    const buttons = pythonFiles.map(file => Markup.button.callback(file, file));
                    await ctx.reply(`Multiple Python scripts found. Please select the main script to run for bot "${botName}":`,
                        Markup.inlineKeyboard(buttons, { columns: 1 }) // Adjust columns as needed
                    );
                }

            } catch (error) {
                console.error('[CreateBotPaste] Error finalizing bot creation:', error);
                clearUserState(userId);
                ctx.reply(`❌ An error occurred while creating the bot "${botName}" from pasted code: ${error.message}`);
            }
            return;
        } else {
            // Accumulate the code text
            const newBuffer = (state.data.codeBuffer || '') + messageText + '
';
            setUserState(userId, 'AWAITING_CODE_PASTE_CONTINUE', { botName, codeBuffer: newBuffer });
            // Optionally acknowledge receipt without replying every time
            // await ctx.reply(`✅ Code chunk received...`); // Might be too noisy
            return;
        }
    }
    // --- End Handle multi-message code paste ---

    // --- Handle receiving requirements text for /req ---
    // (Keep your existing logic for /req text)
    if (state.step === 'AWAITING_REQ_TEXT') {
        const targetBotName = state.data.botName;
        const botInfo = managedBots.get(targetBotName);
        if (!botInfo) {
             clearUserState(userId);
             return ctx.reply(`❌ Error: Target bot '${targetBotName}' not found.`);
        }
        try {
            // Treat the pasted text as the content of requirements.txt
            fs.writeFileSync(botInfo.requirementsPath, messageText);
            console.log(`[Req Text] Requirements text saved to ${botInfo.requirementsPath}`);
            clearUserState(userId);
            ctx.reply(`✅ Requirements text saved for bot "${targetBotName}"!
You can now run the bot with /run_bot ${targetBotName}.`);
        } catch (error) {
            console.error('[Req Text] Error saving requirements:', error);
            clearUserState(userId);
            ctx.reply(`❌ An error occurred while saving the requirements text for "${targetBotName}": ${error.message}`);
        }
        return;
    }
    // --- End Handle receiving requirements text for /req ---

    // --- Handle receiving new code text for /edit_bot ---
    // (Keep your existing logic for /edit_bot text)
    if (state.step === 'AWAITING_CODE_TEXT_EDIT') {
        const targetBotName = state.data.botName;
        clearUserState(userId); // Clear state immediately after getting data
        const botInfo = managedBots.get(targetBotName);
        if (!botInfo) {
             return ctx.reply(`❌ Error: Target bot '${targetBotName}' not found for editing.`);
        }
        const newCodeContent = messageText;
        const targetFilePath = botInfo.filePath; // Path to overwrite
        try {
            fs.writeFileSync(targetFilePath, newCodeContent);
            console.log(`[Edit Text Code] New code saved to ${targetFilePath}`);
            // Stop the bot if it's running, as the code has changed
            if (botInfo.status === 'running' && botInfo.process) {
                 try {
                     // Use helper to stop and clear input state
                     await stopBot(targetBotName);
                     console.log(`[Edit Text Code] Stopped running bot "${targetBotName}" due to code change.`);
                 } catch (killError) {
                     console.error(`[Edit Text Code] Error stopping bot "${targetBotName}" before edit:`, killError);
                     // Continue anyway
                 }
            }
            // Clear logs as code changed
            botInfo.logs = [];
            ctx.reply(`✅ New Python code received and bot "${targetBotName}" updated successfully!
⚠️ The bot has been stopped if it was running. You can now:
- Use /run_bot ${targetBotName} to run the updated version.
- Use /req ${targetBotName} to update requirements if needed.`);
        } catch (error) {
            console.error('[Edit Text Code] Error saving new code:', error);
            ctx.reply(`❌ An error occurred while saving the new code for "${targetBotName}": ${error.message}`);
        }
        return; // Handled edit bot code text
    }
    // --- End Handle receiving new code text for /edit_bot ---

    // Handle other text messages (e.g., if user types something unexpected during a flow)
    // ctx.reply("Please follow the prompts or use /help for commands.");
});
// --- End Modified Handle text input ---

// --- Modified Handle callback queries (button presses) ---
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const state = getUserState(userId);
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery(); // Always answer the callback

    if (!state) {
        // Ignore callback if not in an expected state
        // Optionally inform the user
        // await ctx.answerCbQuery(); // Already done
        // await ctx.reply("Unexpected button press. Please start a new action.");
        return;
    }

    // --- Handle button press for /create_bot source method ---
    if (state.step === 'AWAITING_BOT_CREATION_METHOD') {
        const botName = state.data.botName;
        // Clear state as we proceed to the next step
        clearUserState(userId);

        if (data === 'paste_code') {
            // Introduce a new state for starting the paste process
            setUserState(userId, 'AWAITING_CODE_PASTE_START', { botName });
            await ctx.editMessageText(`✏️ Please paste the Python code for bot "${botName}".
If your code is large and spans multiple messages, paste it all and then send the command /code_done when finished.`);
            return;
        } else if (data === 'upload_file') {
            setUserState(userId, 'AWAITING_FILE_UPLOAD', { botName });
            await ctx.editMessageText(`📤 Okay, please send the Python file (.py) for bot "${botName}".`);
            return;
        } else if (data === 'upload_zip_project') {
            setUserState(userId, 'AWAITING_ZIP_UPLOAD', { botName });
            await ctx.editMessageText(`📦 Please send the .zip file containing your project for bot "${botName}".`);
            return;
        }
        // If it reaches here, it's an unexpected callback in this state
        await ctx.editMessageText("Unexpected option for bot creation. Please start again with /create_bot.");
        return;
    }

    // --- Handle button press for /req source ---
    // (Keep your existing logic for /req)
    if (state.step === 'AWAITING_REQ_SOURCE') {
        const targetBotName = state.data.botName;
        // Clear state as we proceed
        clearUserState(userId);
        if (data === 'upload_req_file') {
            setUserState(userId, 'AWAITING_REQUIREMENTS_UPLOAD', { botName: targetBotName }); // Reuse existing state
            await ctx.editMessageText(`📤 Okay, please send the requirements.txt file for bot "${targetBotName}".`);
        } else if (data === 'paste_req_text') {
            setUserState(userId, 'AWAITING_REQ_TEXT', { botName: targetBotName });
            await ctx.editMessageText(`✏️ Please paste the requirements (one package per line, e.g., 'telegraf==4.12.2') for bot "${targetBotName}".`);
        }
        return; // Handled /req source selection
    }

    // --- Handle button press for /edit_bot source ---
    // (Keep your existing logic for /edit_bot)
    if (state.step === 'AWAITING_EDIT_BOT_SOURCE') {
        const botName = state.data.botName;
        // Note: We already asked how in the command handler
        if (data === 'upload_file_edit') {
            setUserState(userId, 'AWAITING_FILE_UPLOAD_EDIT', { botName }); // New state for editing upload
            await ctx.editMessageText(`📤 Okay, please send the NEW Python file (.py) for bot "${botName}".`);
            return; // Handled edit file upload selection
        } else if (data === 'paste_code_edit') {
            setUserState(userId, 'AWAITING_CODE_TEXT_EDIT', { botName }); // New state for editing paste
            await ctx.editMessageText(`✏️ Please paste the NEW Python code for bot "${botName}".`);
            return; // Handled edit paste code selection
        }
        // Optional: Handle 'view_current_code_edit' if added
        // ...
        // If it reaches here, it's an unexpected callback in this state
        // await ctx.editMessageText("Unexpected button press for editing. Please start again.");
        // clearUserState(userId);
        // return;
    }

    // --- Handle script selection after zip upload/paste ---
    if (state.step === 'AWAITING_SCRIPT_SELECTION') {
        const botName = state.data.botName;
        const projectDir = state.data.projectDir; // Get the project directory from state
        const selectedRelativePath = data; // The callback data is the relative path

        const botInfo = managedBots.get(botName);
        if (!botInfo) {
             await ctx.editMessageText(`❌ Error: Bot "${botName}" not found.`);
             return;
        }

        // Validate the selected path is within the project and is a .py file (optional check)
        const resolvedSelectedPath = path.resolve(projectDir, selectedRelativePath);
        if (!resolvedSelectedPath.startsWith(projectDir)) {
             await ctx.editMessageText(`❌ Invalid file selection.`);
             return;
        }
        if (!fs.existsSync(resolvedSelectedPath) || !resolvedSelectedPath.endsWith('.py')) {
             await ctx.editMessageText(`❌ Selected file is invalid or not a Python script.`);
             return;
        }

        // Update the bot info with the selected main script path
        botInfo.mainScriptPath = resolvedSelectedPath; // Store the full path to the main script
        botInfo.status = 'stopped'; // Ensure status is set

        clearUserState(userId);
        await ctx.editMessageText(`✅ Bot "${botName}" created successfully with main script "${selectedRelativePath}"!
You can now:
- Use /run_bot ${botName} to run it.
- Use /req ${botName} to provide requirements.`);
        return;
    }


    // Ignore callback if not in the expected state
    // await ctx.reply("Unexpected button press. Please start a new action.");
});
// --- End Modified Handle callback queries ---

// --- Modified Handle document uploads ---
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = getUserState(userId);

    if (!state) {
        // Ignore document if not expecting an upload in a known state
        return;
    }

    // --- Handle bot file upload for /create_bot (single .py file) ---
    if (state.step === 'AWAITING_FILE_UPLOAD') {
        try {
            const document = ctx.message.document;
            const fileId = document.file_id;
            const fileName = document.file_name;
            if (!fileName.endsWith('.py')) {
                 ctx.reply('⚠️ Please upload only Python files (.py).');
                 // Don't clear state, let user try again
                 return;
            }
            const botName = state.data.botName;
            // Use the uploaded filename, but associate it with the provided bot name
            const filePath = path.join(uploadsDir, fileName);
            const requirementsPath = path.join(uploadsDir, `${botName}_requirements.txt`);
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            console.log(`[File Upload] Attempting to download from: ${fileUrl}`);
            let buffer;
            try {
                const response = await fetch(fileUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
                console.log(`[File Upload] File downloaded successfully, size: ${buffer.length} bytes.`);
            } catch (fetchError) {
                console.error(`[File Upload] Error fetching file from Telegram:`, fetchError);
                // This error relates to fetching from Telegram, inform user
                ctx.reply(`❌ Could not download the file from Telegram: ${fetchError.message}`);
                return; // Stop processing
            }
            fs.writeFileSync(filePath, buffer);
            console.log(`[File Upload] File written to disk: ${filePath}`);

            // --- NEW: Create venv and store projectDir/mainScriptPath ---
            const venvDir = path.join(uploadsDir, `${botName}_venv`);
            const projectDir = venvDir; // Project lives in venv
            const mainScriptPath = path.join(projectDir, fileName); // Main script is the uploaded file
            const venvRequirementsPath = path.join(venvDir, 'requirements.txt');

            if (!fs.existsSync(venvDir)) {
                console.log(`[FileUpload] Creating virtual environment at: ${venvDir}`);
                const createVenvProcess = exec(`python3 -m venv "${venvDir}"`, { cwd: __dirname });
                await new Promise((res, rej) => {
                    createVenvProcess.on('close', (code) => {
                        if (code === 0) {
                            console.log(`[FileUpload] Successfully created virtual environment.`);
                            res();
                        } else {
                            rej(new Error(`venv create failed with exit code ${code}`));
                        }
                    });
                    createVenvProcess.on('error', rej);
                });
            }
            // Move the uploaded file into the venv/project directory
            const targetPathInVenv = path.join(projectDir, fileName);
            fs.renameSync(filePath, targetPathInVenv);
            console.log(`[FileUpload] Moved uploaded file to: ${targetPathInVenv}`);

            managedBots.set(botName, {
                name: botName,
                projectDir: projectDir,
                mainScriptPath: mainScriptPath,
                requirementsPath: venvRequirementsPath,
                process: null,
                logs: [],
                status: 'stopped'
            });
            if (!fs.existsSync(venvRequirementsPath)) {
                fs.writeFileSync(venvRequirementsPath, '');
            }
            // --- END NEW ---

            clearUserState(userId);
            ctx.reply(`✅ Bot file "${fileName}" uploaded and bot "${botName}" created successfully!
You can now:
- Use /run_bot ${botName} to run it.
- Use /req ${botName} to provide requirements.`);
        } catch (error) {
            console.error('[File Upload] Error:', error);
            clearUserState(userId); // Clear state on error
            ctx.reply(`❌ Error processing the uploaded file for "${state.data.botName}": ${error.message}`);
        }
        return; // Handled bot file upload
    }
    // --- End Handle bot file upload for /create_bot ---

    // --- Handle requirements.txt upload for /req ---
    if (state.step === 'AWAITING_REQUIREMENTS_UPLOAD') {
         const targetBotName = state.data.botName;
         clearUserState(userId); // Clear state immediately
         const botInfo = managedBots.get(targetBotName);
         if (!botInfo) {
             return ctx.reply(`❌ Error: Target bot '${targetBotName}' not found for requirements.`);
         }
         const document = ctx.message.document;
         if (document.file_name !== 'requirements.txt') {
              return ctx.reply('⚠️ Please upload a file named exactly "requirements.txt".');
         }
         try {
             const fileId = document.file_id;
             const fileUrl = await ctx.telegram.getFileLink(fileId);
             console.log(`[Req Upload] Attempting to download from: ${fileUrl}`);
             let buffer;
             try {
                 const response = await fetch(fileUrl);
                 if (!response.ok) {
                     throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
                 }
                 const arrayBuffer = await response.arrayBuffer();
                 buffer = Buffer.from(arrayBuffer);
                 console.log(`[Req Upload] File downloaded successfully, size: ${buffer.length} bytes.`);
             } catch (fetchError) {
                 console.error(`[Req Upload] Error fetching file from Telegram:`, fetchError);
                 // This error relates to fetching from Telegram, inform user
                 ctx.reply(`❌ Could not download the requirements.txt file from Telegram: ${fetchError.message}`);
                 return; // Stop processing
             }
             fs.writeFileSync(botInfo.requirementsPath, buffer);
             console.log(`[Req Upload] File written to disk: ${botInfo.requirementsPath}`);
             ctx.reply(`✅ requirements.txt successfully uploaded and linked to bot "${targetBotName}"!
You can now run the bot with /run_bot ${targetBotName}.`);
         } catch (error) {
             console.error('[Req Upload] Error:', error);
             ctx.reply(`❌ Error processing the uploaded requirements.txt file for "${targetBotName}": ${error.message}`);
         }
         return; // Handled requirements upload
    }
    // --- End Handle requirements.txt upload for /req ---

    // --- Handle bot file upload for /edit_bot ---
    if (state.step === 'AWAITING_FILE_UPLOAD_EDIT') {
        try {
            const document = ctx.message.document;
            const fileId = document.file_id;
            const newFileName = document.file_name;
            if (!newFileName.endsWith('.py')) {
                 return ctx.reply('⚠️ Please upload only Python files (.py).');
                 // State remains, user can try again
            }
            const targetBotName = state.data.botName;
            clearUserState(userId); // Clear state immediately after getting data
            const botInfo = managedBots.get(targetBotName);
            if (!botInfo) {
                return ctx.reply(`❌ Error: Target bot '${targetBotName}' not found for editing.`);
            }
            // Determine the path where the file should be saved.
            // Option 1: Replace the existing file (keeping the managed name association)
            // Option 2: Save with the new uploaded name (updates the managed name)
            // Let's go with Option 1 for simplicity: overwrite the existing file content,
            // but keep the managed fileName/path the same.
            const targetFilePath = botInfo.filePath; // Keep the path managed by the system
            // const newManagedFileName = newFileName; // If you wanted to change the stored name
            // const targetFilePath = path.join(uploadsDir, newManagedFileName); // And update botInfo
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            console.log(`[Edit File Upload] Attempting to download from: ${fileUrl}`);
            let buffer;
            try {
                const response = await fetch(fileUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
                console.log(`[Edit File Upload] File downloaded successfully, size: ${buffer.length} bytes.`);
            } catch (fetchError) {
                console.error(`[Edit File Upload] Error fetching file from Telegram:`, fetchError);
                return ctx.reply(`❌ Could not download the file from Telegram: ${fetchError.message}`);
            }
            // Write the new content to the existing bot's file path
            fs.writeFileSync(targetFilePath, buffer);
            console.log(`[Edit File Upload] New file content written to disk: ${targetFilePath}`);
            // Update the managed bot info if the filename changed (optional, based on choice above)
            // if (newFileName !== botInfo.fileName) {
            //     botInfo.fileName = newFileName;
            //     botInfo.filePath = targetFilePath;
            // }
            // Ensure requirements path exists (should already, but double-check)
            if (!fs.existsSync(botInfo.requirementsPath)) {
                fs.writeFileSync(botInfo.requirementsPath, '');
            }
            // Stop the bot if it's running, as the code has changed
            if (botInfo.status === 'running' && botInfo.process) {
                 try {
                     // Use helper to stop and clear input state
                     await stopBot(targetBotName);
                     console.log(`[Edit File Upload] Stopped running bot "${targetBotName}" due to code change.`);
                 } catch (killError) {
                     console.error(`[Edit File Upload] Error stopping bot "${targetBotName}" before edit:`, killError);
                     // Continue anyway
                 }
            }
            // Clear logs as code changed
            botInfo.logs = [];
            ctx.reply(`✅ New bot file content uploaded and bot "${targetBotName}" updated successfully!
⚠️ The bot has been stopped if it was running. You can now:
- Use /run_bot ${targetBotName} to run the updated version.
- Use /req ${targetBotName} to update requirements if needed.`);
        } catch (error) {
            console.error('[Edit File Upload] Error:', error);
            clearUserState(userId); // Ensure state is clear on error
            ctx.reply(`❌ Error processing the uploaded file for editing bot "${state.data.botName}": ${error.message}`);
        }
        return; // Handled edit bot file upload
    }
    // --- End Handle bot file upload for /edit_bot ---

    // --- Handle .zip project upload for /create_bot ---
    if (state.step === 'AWAITING_ZIP_UPLOAD') {
        try {
            const document = ctx.message.document;
            const fileId = document.file_id;
            const fileName = document.file_name;
            const targetBotName = state.data.botName;

            if (!fileName.endsWith('.zip')) {
                return ctx.reply('⚠️ Please upload only .zip files for projects.');
            }

            clearUserState(userId); // Clear state immediately after getting data

            const venvDir = path.join(uploadsDir, `${targetBotName}_venv`);
            const requirementsPath = path.join(venvDir, 'requirements.txt'); // Standard location
            const projectDir = venvDir; // Project extracted into venv dir

            // 1. Create the virtual environment directory first (if it doesn't exist)
            // The zip extraction will populate it. Creating it first ensures the path exists.
            if (!fs.existsSync(venvDir)) {
                fs.mkdirSync(venvDir, { recursive: true });
                console.log(`[ZipUpload] Created directory for bot project/venv: ${venvDir}`);
            }

            // 2. Download the zip file
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            console.log(`[ZipUpload] Attempting to download zip from: ${fileUrl}`);
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch zip file: ${response.status} ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const zipBuffer = Buffer.from(arrayBuffer);
            console.log(`[ZipUpload] Zip file downloaded successfully, size: ${zipBuffer.length} bytes.`);

            // 3. Extract the zip file directly into the venv/project directory
            const zip = new AdmZip(zipBuffer);
            // Extract to the project directory, overwriting existing files
            zip.extractAllTo(projectDir, true); // true = overwrite
            console.log(`[ZipUpload] Zip file extracted to: ${projectDir}`);

            // 4. Find all .py files in the extracted project directory for script selection
            const pythonFiles = findPythonFiles(projectDir);

            if (pythonFiles.length === 0) {
                return ctx.reply(`❌ No Python files found in the uploaded .zip project for "${targetBotName}". Bot creation failed.`);
            } else if (pythonFiles.length === 1) {
                // Only one .py file, auto-select it
                const selectedScriptPath = path.join(projectDir, pythonFiles[0]);
                managedBots.set(targetBotName, {
                    name: targetBotName,
                    projectDir: projectDir,
                    mainScriptPath: selectedScriptPath,
                    requirementsPath: requirementsPath,
                    process: null,
                    logs: [],
                    status: 'stopped'
                });
                await ctx.reply(`✅ Bot project "${targetBotName}" uploaded and extracted successfully. Main script "${pythonFiles[0]}" selected automatically.
You can now:
- Use /run_bot ${targetBotName} to run it.
- Use /req ${targetBotName} to provide/update requirements.`);
            } else {
                // Multiple .py files, ask user to choose
                setUserState(userId, 'AWAITING_SCRIPT_SELECTION', { botName: targetBotName, projectDir });
                const buttons = pythonFiles.map(file => Markup.button.callback(file, file));
                await ctx.reply(`Bot project "${targetBotName}" uploaded and extracted successfully. Multiple Python scripts found. Please select the main script to run:`,
                    Markup.inlineKeyboard(buttons, { columns: 1 })
                );
            }

        } catch (error) {
            console.error('[ZipUpload] Error:', error);
            clearUserState(userId); // Ensure state is clear on error
            ctx.reply(`❌ Error processing the uploaded .zip file for bot "${state.data?.botName || 'unknown'}": ${error.message}`);
        }
        return; // Handled zip upload
    }
    // --- End Handle .zip project upload ---

    // Ignore document if not in the expected state
    // ctx.reply("Please use /create_bot <name> first if you want to add a file.");
});
// --- End Modified Handle document uploads ---

// Start the bot
bot.launch({ polling: true })
    .then(() => {
        console.log('🚀 Telegram Master Bot started!');
    })
    .catch((err) => {
        // This is a critical startup error (e.g., network issue, invalid token for polling)
        // Cannot reliably send message to Telegram if launch fails
        console.error('Failed to launch bot:', err);
        process.exit(1);
    });

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    // Attempt to stop all running bots
    for (const [botName, botInfo] of managedBots.entries()) {
        if (botInfo.status === 'running') {
            stopBot(botName, 'SIGINT');
        }
    }
    bot.stop('SIGINT')
       .then(() => console.log('Bot stopped.'))
       .catch(console.error);
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    // Attempt to stop all running bots
    for (const [botName, botInfo] of managedBots.entries()) {
        if (botInfo.status === 'running') {
            stopBot(botName, 'SIGTERM');
        }
    }
    bot.stop('SIGTERM')
       .then(() => console.log('Bot stopped.'))
       .catch(console.error);
    process.exit(0);
});
