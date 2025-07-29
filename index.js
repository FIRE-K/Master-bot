// index.js
const { Telegraf, Markup } = require('telegraf'); // Import Markup for buttons
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

// Track state for multi-step interactions
const userStates = {}; // userId -> { step: '...', data: {...} }

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
                            rej(new Error(`venv create failed with exit code ${code}\nStderr:\n${createStderr}`));
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
                         rej(new Error(`pip upgrade failed with exit code ${code}\nStderr:\n${upgradeStderr}`));
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
                    reject(new Error(`pip install failed with exit code ${code}\nStderr:\n${stderrData}`));
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

// --- Helper to Stop a Bot (for deletion) ---
async function stopBot(botName) {
    const botInfo = managedBots.get(botName);
    if (botInfo && botInfo.status === 'running' && botInfo.process) {
        try {
            botInfo.process.kill('SIGTERM');
            botInfo.process = null;
        } catch (error) {
            console.error(`[StopBotHelper] Error killing process for ${botName}:`, error);
            // Continue with potential deletion even if kill fails
        }
    }
    if (botInfo) {
        botInfo.status = 'stopped';
    }
}
// --- End Helper to Stop a Bot ---

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
/delete_bot <name> - Deletes a bot. It will be stopped if currently running.
/run_bot <name> - Starts a specific bot (installs requirements if provided).
/stop_bot <name> - Stops a running bot.
/req <name> - Initiates the process to add requirements for an existing bot.
/source <name> - Sends the source code and requirements for a bot.
/logs <name> - Displays the last logs for a bot.
/help - Shows this help message.
Steps to add a bot:
1. Use /create_bot <unique_bot_name>.
2. Choose whether to upload a .py file or paste code directly.
3. (Optional) Later, use /req <bot_name> to provide requirements (upload file or paste text).
4. Run your bot with /run_bot <bot_name>.`;
    ctx.reply(helpMessage);
});

// Command: Run bot
bot.command('run_bot', async (ctx) => {
    // console.log("[DEBUG] /run_bot command handler triggered");
    const botName = ctx.message.text.split(' ')[1];
    if (!botName) {
        return ctx.reply('⚠️ Usage: /run_bot <bot_name>');
    }
    const botInfo = managedBots.get(botName);
    if (!botInfo) {
        return ctx.reply(`❌ Bot "${botName}" not found.`);
    }
    if (botInfo.status === 'running') {
        return ctx.reply(`ℹ️ Bot "${botName}" is already running.`);
    }
    try {
        const installingMsg = await ctx.reply(`⏳ Installing requirements for "${botName}" (if any)...`);
        let venvPythonPathForBot = 'python3'; // Default fallback
        try {
            const installResult = await installRequirements(botInfo.requirementsPath, botName);
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `✅ Requirements installed (or none found) for "${botName}".`);
            // Use the Python path from the venv if installation was successful
            if (installResult && installResult.venvPythonPath) {
                venvPythonPathForBot = installResult.venvPythonPath;
            }
        } catch (installError) {
            console.error(`[RunBot] Error installing requirements for ${botName}:`, installError);
            // Detailed error sent to user
            const errorMessage = installError.message.length > 300 ?
                installError.message.substring(0, 300) + '... (truncated)' :
                installError.message;
            await ctx.telegram.editMessageText(ctx.chat.id, installingMsg.message_id, undefined, `❌ Failed to install requirements for "${botName}". Bot not runned.
Error: ${errorMessage}`);
            return; // Stop if install failed
        }
        console.log(`[RunBot: ${botName}] Running Python bot: ${botInfo.filePath} using Python: ${venvPythonPathForBot}`);
        const fullPath = path.resolve(uploadsDir, botInfo.fileName);
        // Use venvPythonPathForBot instead of 'python3'
        const pythonProcess = spawn(venvPythonPathForBot, [fullPath], {
            cwd: uploadsDir
        });
        botInfo.process = pythonProcess;
        botInfo.status = 'running';
        botInfo.logs = []; // Clear previous logs on restart
        pythonProcess.stdout.on('data', (data) => {
            const log = data.toString();
            botInfo.logs.push(`[STDOUT] ${log}`);
            console.log(`[${botName}] ${log}`);
        });
        pythonProcess.stderr.on('data', (data) => {
            const log = data.toString();
            botInfo.logs.push(`[STDERR] ${log}`);
            console.error(`[${botName}] ${log}`);
        });
        pythonProcess.on('close', (code) => {
            botInfo.status = 'stopped';
            botInfo.process = null;
            botInfo.logs.push(`[EXIT] Process exited with code ${code}`);
            console.log(`[${botName}] Process exited with code ${code}`);
        });
        ctx.reply(`🚀 Bot "${botName}" started successfully!`);
    } catch (error) {
        console.error('[RunBot] Unexpected error:', error);
        ctx.reply(`❌ Error running bot "${botName}": ${error.message}`);
    }
});

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
        if (botInfo.process) {
            botInfo.process.kill('SIGTERM');
            botInfo.process = null;
        }
        botInfo.status = 'stopped';
        ctx.reply(`⏹️ Bot "${botName}" stopped successfully!`);
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
    message += recentLogs.join('\n');
    if (message.length > 4000) {
        message = message.substring(0, 4000) + '\n... (truncated)';
    }
    ctx.reply(message);
});

// Error handling for the bot itself (catches errors in middleware/handlers)
bot.catch((err, ctx) => {
    console.error('Bot error:', err); // Always log to console for debugging
    // Clear user state on bot error to prevent getting stuck
    clearUserState(ctx.from.id);
    // Send a generic error message to the user
    ctx.reply('❌ An unexpected error occurred in the master bot. Please try your command again.');
});


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
    try {
        console.log(`[Source] User requested source for bot: ${targetBotName}`);

        // --- Send Bot Code File ---
        let codeSent = false;
        if (fs.existsSync(botInfo.filePath)) {
            try {
                // Send the actual .py file
                await ctx.replyWithDocument({ source: botInfo.filePath }, {
                    caption: `🐍 Python code for bot: ${targetBotName}`
                });
                console.log(`[Source] Sent bot code file: ${botInfo.filePath}`);
                codeSent = true;
            } catch (sendError) {
                console.error(`[Source] Error sending bot code file ${botInfo.filePath}:`, sendError);
                // If sending the file path fails, we could try sending as buffer, or just error
                // For simplicity here, we'll report the error
                await ctx.reply(`❌ Error sending bot code file "${botInfo.fileName}" for "${targetBotName}": ${sendError.message}`);
            }
        } else {
             await ctx.reply(`📝 No Python code file found for bot "${targetBotName}".`);
        }

        // --- Send Requirements File ---
        let reqSent = false;
        if (fs.existsSync(botInfo.requirementsPath)) {
             const stats = fs.statSync(botInfo.requirementsPath);
             if (stats.size > 0) {
                 try {
                     // Send the actual requirements.txt file
                     await ctx.replyWithDocument({ source: botInfo.requirementsPath }, {
                         caption: `📄 Requirements for bot: ${targetBotName}`
                     });
                     console.log(`[Source] Sent requirements file: ${botInfo.requirementsPath}`);
                     reqSent = true;
                 } catch (sendError) {
                     console.error(`[Source] Error sending requirements file ${botInfo.requirementsPath}:`, sendError);
                     await ctx.reply(`❌ Error sending requirements file for "${targetBotName}": ${sendError.message}`);
                 }
             } else {
                 await ctx.reply(`📝 Requirements file for "${targetBotName}" is empty.`);
             }
        } else {
             await ctx.reply(`📝 No requirements file found for bot "${targetBotName}".`);
        }

        // Send a final confirmation message if at least one file was sent successfully
        if (codeSent || reqSent) {
             await ctx.reply(`✅ Source files for bot "${targetBotName}" sent.`);
        } else {
            // If neither file was sent successfully, the specific errors were already sent above
            // This else clause might be redundant but ensures feedback if paths don't exist
            if (!fs.existsSync(botInfo.filePath) && !fs.existsSync(botInfo.requirementsPath)) {
                 // Message already sent above
            } else {
                 // This case implies files existed but sending failed, errors sent above
            }
        }
        console.log(`[Source] Finished processing source request for ${targetBotName}`);
    } catch (error) {
        console.error(`[Source] Unexpected error for bot ${targetBotName}:`, error);
        // Sending a generic error reply is usually safe
        await ctx.reply(`❌ An unexpected error occurred while retrieving or sending the source files for "${targetBotName}".`);
    }
});
// --- End NEW COMMAND: /source <bot> (Send as Files) ---

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
    setUserState(userId, 'AWAITING_BOT_SOURCE', { botName: sanitizedBotName });
    ctx.reply(`📝 How would you like to provide the code for "${sanitizedBotName}"?`,
        Markup.inlineKeyboard([
            Markup.button.callback('📤 Upload .py File', 'upload_file'),
            Markup.button.callback('✏️ Paste Code Text', 'paste_code')
        ])
    );
});

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
        // Stop the bot if it's running
        await stopBot(targetBotName);
        // Delete files
        try {
            if (fs.existsSync(botInfo.filePath)) {
                fs.unlinkSync(botInfo.filePath);
                console.log(`[DeleteBot] Deleted bot file: ${botInfo.filePath}`);
            }
            if (fs.existsSync(botInfo.requirementsPath)) {
                fs.unlinkSync(botInfo.requirementsPath);
                console.log(`[DeleteBot] Deleted requirements file: ${botInfo.requirementsPath}`);
            }
            // --- NEW: Attempt to delete the virtual environment ---
            const venvDirToDelete = path.join(uploadsDir, `${targetBotName}_venv`);
            if (fs.existsSync(venvDirToDelete)) {
                try {
                    fs.rmSync(venvDirToDelete, { recursive: true, force: true }); // Use rmSync for simplicity, ensure recursive
                    console.log(`[DeleteBot] Deleted virtual environment: ${venvDirToDelete}`);
                } catch (venvError) {
                    console.error(`[DeleteBot] Error deleting virtual environment ${venvDirToDelete}:`, venvError);
                    // Inform user about venv deletion failure, but continue removing from map
                    await ctx.reply(`⚠️ Bot "${targetBotName}" entry removed, but there was an error deleting its virtual environment: ${venvError.message}`);
                }
            }
            // --- END NEW ---
        } catch (fileError) {
            console.error(`[DeleteBot] Error deleting files for ${targetBotName}:`, fileError);
            // Don't prevent deletion from map if file deletion fails, inform user
            await ctx.reply(`⚠️ Bot "${targetBotName}" entry removed, but there was an error deleting its files: ${fileError.message}`);
            // Continue to remove from map
        }
        // Remove from managed bots map
        managedBots.delete(targetBotName);
        console.log(`[DeleteBot] Bot "${targetBotName}" deleted.`);
        ctx.reply(`✅ Bot "${targetBotName}" has been deleted.`);
    } catch (error) {
        console.error(`[DeleteBot] Error deleting bot ${targetBotName}:`, error);
        ctx.reply(`❌ An error occurred while deleting bot "${targetBotName}": ${error.message}`);
    }
});

// Handle text input based on user state
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = getUserState(userId);
    const messageText = ctx.message.text.trim();
    if (!state) {
        // If user sends text outside a flow, just acknowledge or ignore
        // ctx.reply("Send a command like /create_bot <name> or /req <name>.");
        return; // Silent ignore is often better UX
    }
    // --- Handle receiving code text for /create_bot ---
    if (state.step === 'AWAITING_CODE_TEXT') {
        const botName = state.data.botName;
        const fileName = `${botName}.py`;
        const filePath = path.join(uploadsDir, fileName);
        const requirementsPath = path.join(uploadsDir, `${botName}_requirements.txt`);
        try {
            fs.writeFileSync(filePath, messageText);
            console.log(`[Text Code] Code saved to ${filePath}`);
            managedBots.set(botName, {
                name: botName,
                fileName: fileName,
                filePath: filePath,
                requirementsPath: requirementsPath,
                process: null,
                logs: [],
                status: 'stopped'
            });
            if (!fs.existsSync(requirementsPath)) {
                fs.writeFileSync(requirementsPath, '');
            }
            clearUserState(userId);
            ctx.reply(`✅ Python code received and bot "${botName}" created successfully!
You can now:
- Use /run_bot ${botName} to run it.
- Use /req ${botName} to provide requirements.`);
        } catch (error) {
            console.error('[Text Code] Error saving code:', error);
            clearUserState(userId);
            ctx.reply(`❌ An error occurred while saving the code for "${botName}": ${error.message}`);
        }
        return;
    }
    // --- End Handle receiving code text for /create_bot ---
    // --- Handle receiving requirements text for /req ---
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
    // Handle other text messages (e.g., if user types something unexpected during a flow)
    // ctx.reply("Please follow the prompts or use /help for commands.");
});

// Handle callback queries (button presses)
bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const state = getUserState(userId);
    const data = ctx.callbackQuery.data; // e.g., 'upload_file', 'paste_code', 'upload_req_file', 'paste_req_text'
    // Answer the callback query to remove loading indicator
    await ctx.answerCbQuery();
    // --- Handle button press for /create_bot source ---
    if (state && state.step === 'AWAITING_BOT_SOURCE') {
        const botName = state.data.botName;
        clearUserState(userId); // Clear state as we proceed
        if (data === 'upload_file') {
            setUserState(userId, 'AWAITING_FILE_UPLOAD', { botName });
            await ctx.editMessageText(`📤 Okay, please send the Python file (.py) for bot "${botName}".`);
        } else if (data === 'paste_code') {
            setUserState(userId, 'AWAITING_CODE_TEXT', { botName });
            await ctx.editMessageText(`✏️ Please paste the Python code for bot "${botName}".`);
        }
        return;
    }
    // --- End Handle button press for /create_bot source ---
    // --- Handle button press for /req source ---
    if (state && state.step === 'AWAITING_REQ_SOURCE') {
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
    // --- End Handle button press for /req source ---
    // Ignore callback if not in the expected state
    // ctx.reply("Unexpected button press. Please start a new action.");
});

// Handle document uploads based on user state
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = getUserState(userId);
    // --- Handle bot file upload for /create_bot ---
    if (state && state.step === 'AWAITING_FILE_UPLOAD') {
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
            managedBots.set(botName, {
                name: botName, // Keep the name provided by the user
                fileName: fileName, // Store the actual uploaded filename
                filePath: filePath,
                requirementsPath: requirementsPath,
                process: null,
                logs: [],
                status: 'stopped'
            });
            if (!fs.existsSync(requirementsPath)) {
                fs.writeFileSync(requirementsPath, '');
            }
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
    if (state && state.step === 'AWAITING_REQUIREMENTS_UPLOAD') {
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
    // Ignore document if not expecting an upload in a known state
    // ctx.reply("Please use /create_bot <name> or /req <name> first if you want to add a file.");
});

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
    bot.stop('SIGINT')
       .then(() => console.log('Bot stopped.'))
       .catch(console.error);
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    bot.stop('SIGTERM')
       .then(() => console.log('Bot stopped.'))
       .catch(console.error);
    process.exit(0);
});
