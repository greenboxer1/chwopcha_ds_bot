//Библиотеки
import { 
    REST, Routes, ApplicationCommandOptionType, Client, IntentsBitField, 
    managerToFetchingStrategyOptions, Guild, User, EmbedBuilder, time, 
    SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, PermissionsBitField, ModalBuilder, TextInputBuilder, 
    TextInputStyle, ChannelType, Partials
} from 'discord.js';

import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType, 
    NoSubscriberBehavior,
    AudioPlayerStatus,
    getVoiceConnection
} from '@discordjs/voice';
import googleTTS from 'google-tts-api';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { EventEmitter } from 'events'
import process from 'process';

//Конфиги
import env from "./config/env.js";
import channelConfigs from "./config/guilds_settings.js";
import * as phrases from "./config/phrases.js";
import { json } from 'stream/consumers';

//Мои вспомогательные функции
const dateNow = () => {
    const now = new Date();
    const padZero = (num) => num < 10 ? `0${num}` : num;
    return `${padZero(now.getDate())}.${padZero(now.getMonth() + 1)}.${now.getFullYear()} (${padZero(now.getHours())}:${padZero(now.getMinutes())})`;
}

const debug = (consoleMsg) => {
    console.log(`[${dateNow()}] ${consoleMsg}`)
}

debug('Script started')


const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
})


const getServerConfig = (msg) => {
    return channelConfigs.filter(guild => guild.guildId === msg.guildId)[0]
}

const getServerLang = (msg) => {
    return getServerConfig(msg).lang
}



const sendMsgToAdmin = async(text_message) => {
    try {
        const adminUser = await client.users.fetch(env.adminId);
        await adminUser.send(text_message);
    } catch (error) {
        console.error('Error when send msg to admin', error);
    }
}

// ГОВОРИЛКА ГОВОРИЛКА ГОВОРИЛКА ГОВОРИЛКА ГОВОРИЛКА

const SPEECH_SPEEDS = {
    'ru': '1.3', 
    'en': '1.1' 
}; 

// Выбор FFmpeg: на Windows берем статик, на Linux системный
const FFMPEG_COMMAND = process.platform === 'win32' ? ffmpegPath : 'ffmpeg';

// ==========================================
// 2. СЕССИИ (Состояние серверов)
// ==========================================
// Key: GuildID, Value: Session Object
const sessions = new Map();

/**
 * Получает сессию для сервера или создает новую
 */
function getSession(guildId) {
    if (!sessions.has(guildId)) {
        sessions.set(guildId, {
            player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
            queue: [],          // Очередь: [{ url, message }]
            currentItem: null,  // Что играет сейчас
            speechSpeed: '1.3'
        });

        const session = sessions.get(guildId);
        
        // Настраиваем слушатели ОДИН РАЗ при создании сессии
        session.player.on(AudioPlayerStatus.Idle, () => {
            processQueue(guildId); // Когда договорил -> следующий
        });

        session.player.on('error', (error) => {
            console.error(`Player Error [${guildId}]:`, error.message);
            processQueue(guildId); // При ошибке -> следующий
        });
    }
    return sessions.get(guildId);
}

// ==========================================
// 3. АУДИО ЛОГИКА
// ==========================================

/**
 * Запускает FFmpeg и передает поток в плеер
 */
function playStream(session, url) {
    const ffmpegProcess = spawn(FFMPEG_COMMAND, [
        '-analyzeduration', '0',
        '-probesize', '32',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-i', url,
        '-filter:a', `atempo=${session.speechSpeed}`,
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '1',
        'pipe:1'
    ]);

    // Глушим stderr, чтобы не засорять консоль, если всё ок
    ffmpegProcess.stderr.on('data', () => {}); 

    const resource = createAudioResource(ffmpegProcess.stdout, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });

    session.player.play(resource);
}

/**
 * Обрабатывает очередь: берет следующий трек и удаляет реакции
 */
async function processQueue(guildId) {
    const session = sessions.get(guildId);
    if (!session) return;

    // --- ЛОГИКА УДАЛЕНИЯ РЕАКЦИИ ---
    // Если что-то играло до этого
    if (session.currentItem) {
        const prevMsg = session.currentItem.message;
        const nextItem = session.queue[0];

        // Если очередь пуста ИЛИ следующее сообщение отличается от предыдущего
        // Значит, мы дочитали сообщение до конца
        if (!nextItem || nextItem.message.id !== prevMsg.id) {
            try {
                const reaction = prevMsg.reactions.cache.get('🔇');
                if (reaction) await reaction.users.remove(client.user.id);
            } catch (e) { /* Игнор ошибок (сообщение удалено и т.д.) */ }
        }
    }

    // Если пусто - останавливаемся
    if (session.queue.length === 0) {
        session.currentItem = null;
        return;
    }

    // Берем следующий
    const nextTrack = session.queue.shift();
    session.currentItem = nextTrack;

    playStream(session, nextTrack.url);
}

// ==========================================
// 4. ФУНКЦИЯ TTS (Которую ты потерял)
// ==========================================

export async function executeVoiceTTS(message) {
// 1. Проверки валидности
    // [ИЗМЕНЕНО] Добавлена проверка на наличие вложений (картинки/гифки), 
    // чтобы не озвучивать пустые сообщения с файлами
    if (message.author.bot || (!message.content && message.attachments.size > 0)) return;
    if (!message.content || message.channel.type !== ChannelType.GuildVoice) return;

    // [НОВОЕ] Очистка текста перед озвучкой
    let textToSpeak = message.content
        .replace(/https?:\/\/\S+/gi, '') // Удаляем любые ссылки (http/https)
        .replace(/<@!?\d+>/g, '')        // Удаляем пинги пользователей (<@ID>)
        .replace(/<@&\d+>/g, '')         // Удаляем пинги ролей (<@&ID>)
        .replace(/<#\d+>/g, '')          // Удаляем упоминания каналов (<#ID>)
        .trim();

    // [НОВОЕ] Если после очистки (удаления ссылок и пингов) текста не осталось — выходим
    if (!textToSpeak) return;

    const guildId = message.guild.id;
    
    // 2. Проверка: Автор в том же канале?
    const memberVoiceChannelId = message.member?.voice?.channelId;
    const botChannelId = message.channel.id;

    if (!memberVoiceChannelId || memberVoiceChannelId !== botChannelId) {
        return; 
    }

    // ... (далее код идет без изменений до момента генерации ссылок) ...

    try {
        const session = getSession(guildId);
        const lang = getServerLang(message);
        session.speechSpeed = SPEECH_SPEEDS[lang] || SPEECH_SPEEDS['ru'];

        // [ИЗМЕНЕНО] Передаем очищенный textToSpeak вместо message.content
        const results = googleTTS.getAllAudioUrls(textToSpeak, {
            lang: lang,
            slow: false,
            host: 'https://translate.google.com',
            splitPunctuation: '.!?,:;'
        });

        // Добавляем в очередь
        results.forEach(item => {
            session.queue.push({
                url: item.url,
                message: message
            });
        });

        await message.react('🔇');

        // Подключение
        const connection = joinVoiceChannel({
            channelId: botChannelId,
            guildId: guildId,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: true,
        });
        connection.subscribe(session.player);

        // Если плеер спит - будим его
        if (session.player.state.status === AudioPlayerStatus.Idle) {
            processQueue(guildId);
        }

    } catch (error) {
        console.error("TTS Error:", error);
    }
}

// --- Автовыход (Voice State Update) ---
client.on('voiceStateUpdate', (oldState, newState) => {
    const channel = oldState.channel;
    if (!channel) return;

    const guildId = channel.guild.id;
    const connection = getVoiceConnection(guildId);

    // Если бот в этом канале
    if (connection && connection.joinConfig.channelId === channel.id) {
        const humans = channel.members.filter(m => !m.user.bot).size;
        
        // Если все вышли
        if (humans === 0) {
            connection.destroy();
            if (sessions.has(guildId)) {
                const session = sessions.get(guildId);
                session.player.stop();
                session.queue = [];
                session.currentItem = null;
            }
        }
    }
});

// --- Кнопка Стоп ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== '🔇') return;

    const guildId = reaction.message.guild.id;
    if (sessions.has(guildId)) {
        const session = sessions.get(guildId);
        
        session.player.stop();
        session.queue = [];
        session.currentItem = null;

        try {
            await reaction.users.remove(client.user.id);
        } catch (e) {}
        debug(`[Stop] ${user.username} остановил TTS.`)
    }
});

//   
//  СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА
//  СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА
//  СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА СЛЕШ КОМАНДЫ КНОПКИ И ПРОЧАЯ ХУЕТА
//  


// Регистрация слеш команд
const registerCommands = async (client) => {
    const commands = [
        {
            name: 'give-role-button',
            description: 'Creates a button to assign a role',
            options: [
                {
                    name: 'role',
                    description: 'The role to be assigned by the button',
                    type: 8,
                    required: true
                },
                {
                    name: 'text',
                    description: 'The text above the button',
                    type: 3,
                    required: true
                }
            ]
        },
        {
            name: 'embed',
            description: 'Create a custom embed message'
        }
    ];

    const rest = new REST({ version: '10', timeout: 30000 }).setToken(env.token);

    try {
        debug('Started refreshing application (/) commands for all guilds.');
        
        // Получаем все серверы где находится бот
        const guilds = client.guilds.cache;
        const registerPromises = [];

        for (const [guildId, guild] of guilds) {
            debug(`Registering commands for guild: ${guild.name} (${guildId})`);
            
            const promise = rest.put(
                Routes.applicationGuildCommands(env.clientId, guildId),
                { body: commands }
            ).catch(error => {
                console.error(`Failed to register commands for guild ${guild.name} (${guildId}):`, error);
            });
            
            registerPromises.push(promise);
        }

        await Promise.all(registerPromises);
        debug(`Successfully registered commands for ${guilds.size} guilds.`);
    } catch (error) {
        console.error('Error registering commands:', error);
    }
};


// Обработка взаимодействий (команды, кнопки и модальные окна)
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
    }
});

// Обработка слеш-команд
async function handleSlashCommand(interaction) {
    debug('Slash command create give role button')
    const { commandName } = interaction;

    if (commandName === 'give-role-button') {
        // Проверка прав администратора
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command! Administrator rights required.',
                ephemeral: true
            });
        }

        const role = interaction.options.getRole('role');
        const text = interaction.options.getString('text');

        if (!role.editable) {
            return await interaction.reply({
                content: 'I cannot assign this role! Ensure my role is higher than the selected role in the server settings.',
                ephemeral: true
            });
        }

        await createRoleButtons(interaction, role, text);
    } else if (commandName === 'embed') {
        // Проверка прав администратора
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.reply({
                content: 'You do not have permission to use this command! Administrator rights required.',
                ephemeral: true
            });
        }

        await showEmbedModal(interaction);
    }
}

// Показать модальное окно для создания эмбеда
async function showEmbedModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('embed_modal')
        .setTitle('Create Custom Embed');

    // Поле для заголовка
    const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Embed Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(256);

    // Поле для описания
    const descriptionInput = new TextInputBuilder()
        .setCustomId('embed_description')
        .setLabel('Embed Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

    // Поле для цвета (HEX) с подсказкой о сайте
    const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel('Embed Color (HEX) - Pick at csscolor.ru')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('#FF0000 - Visit https://csscolor.ru/')
        .setMaxLength(7);

    // Поле для URL изображения (будет внизу эмбеда)
    const imageInput = new TextInputBuilder()
        .setCustomId('embed_image')
        .setLabel('Large Image URL (displays at bottom)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('https://example.com/image.png');

    // Поле для URL миниатюры (будет справа вверху)
    const thumbnailInput = new TextInputBuilder()
        .setCustomId('embed_thumbnail')
        .setLabel('Thumbnail URL (small image top right)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('https://example.com/thumbnail.png');

    // Добавляем поля в строки
    const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
    const secondActionRow = new ActionRowBuilder().addComponents(descriptionInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(colorInput);
    const fourthActionRow = new ActionRowBuilder().addComponents(imageInput);
    const fifthActionRow = new ActionRowBuilder().addComponents(thumbnailInput);

    // Добавляем строки в модальное окно
    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);

    await interaction.showModal(modal);
}

// Обработка отправки модального окна
async function handleModalSubmit(interaction) {
    if (interaction.customId !== 'embed_modal') return;

    await interaction.deferReply({ ephemeral: true });

    const title       = interaction.fields.getTextInputValue('embed_title') || null;
    const description = interaction.fields.getTextInputValue('embed_description');
    const color       = interaction.fields.getTextInputValue('embed_color');
    const image       = interaction.fields.getTextInputValue('embed_image') || null;
    const thumbnail   = interaction.fields.getTextInputValue('embed_thumbnail') || null;

    const embed = new EmbedBuilder().setDescription(description || ' ');

    if (title) embed.setTitle(title);

    // === Цвет (уже починили раньше) ===
    if (color?.trim()) {
        const colorInt = parseInt(color.trim().replace('#', ''), 16);
        embed.setColor(isNaN(colorInt) || colorInt > 0xFFFFFF ? 0xB4FBFF : colorInt);
    } else {
        embed.setColor(0xB4FBFF);
    }

    // === БЕЗОПАСНАЯ функция для установки изображения ===
    const setImageSafely = (url) => {
        if (!url || !url.trim()) return;
        try {
            new URL(url.trim()); // простая проверка, что это URL
            if (/https?:\/\/.*\.(png|jpe?g|gif|webp)/i.test(url)) {
                embed.setImage(url.trim());
            }
            // если не картинка — просто игнорим, не крашим
        } catch {
            // невалидный URL — молча игнорим
        }
    };

    const setThumbnailSafely = (url) => {
        if (!url || !url.trim()) return;
        try {
            new URL(url.trim());
            if (/https?:\/\/.*\.(png|jpe?g|gif|webp)/i.test(url)) {
                embed.setThumbnail(url.trim());
            }
        } catch {
            // игнор
        }
    };

    setImageSafely(image);
    setThumbnailSafely(thumbnail);

    // === Теперь try/catch точно всё поймает ===
    try {
        await interaction.channel.send({ embeds: [embed] });
        await interaction.editReply({ content: 'Эмбед успешно отправлен в канал!' });
    } catch (error) {
        console.error('Ошибка при F отправке:', error);
        await interaction.editReply({ 
            content: 'Не смог отправить эмбед (нет прав или канал удалён)' 
        });
    }
}

// Создание кнопок для выдачи роли
async function createRoleButtons(interaction, role, text) {
    const assignButton = new ButtonBuilder()
        .setCustomId(`give_role_${role.id}`)
        .setLabel('Get Role')
        .setStyle(ButtonStyle.Primary);

    const removeButton = new ButtonBuilder()
        .setCustomId(`remove_role_${role.id}`)
        .setLabel('Remove Role')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(assignButton, removeButton);

    await interaction.reply({
        content: text,
        components: [row]
    });
}

// Обработка нажатия кнопок
async function handleButtonInteraction(interaction) {
    debug('Some user trigger give role button')
    const roleId = interaction.customId.split('_')[2];
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
        return await interaction.reply({
            content: 'Role not found!',
            ephemeral: true
        });
    }

    const isGiveRole = interaction.customId.startsWith('give_role_');
    const isRemoveRole = interaction.customId.startsWith('remove_role_');

    if (isGiveRole) {
        await handleRoleAssignment(interaction, role, true);
    } else if (isRemoveRole) {
        await handleRoleAssignment(interaction, role, false);
    }
}

// Универсальная функция для выдачи/удаления роли
async function handleRoleAssignment(interaction, role, isAssigning) {
    const hasRole = interaction.member.roles.cache.has(role.id);
    const action = isAssigning ? 'add' : 'remove';
    const successMessage = isAssigning ? 'assigned' : 'removed';
    const errorMessage = isAssigning ? 'assigning' : 'removing';

    // Проверки в зависимости от действия
    if (isAssigning && hasRole) {
        return await interaction.reply({
            content: `You already have the role ${role.name}!`,
            ephemeral: true
        });
    }

    if (!isAssigning && !hasRole) {
        return await interaction.reply({
            content: `You don't have the role ${role.name}!`,
            ephemeral: true
        });
    }

    try {
        await interaction.member.roles[action](role);
        await interaction.reply({
            content: `Role ${role.name} ${successMessage} successfully!`,
            ephemeral: true
        });
    } catch (error) {
        console.error(`Error ${errorMessage} role:`, error);
        await interaction.reply({
            content: `An error occurred while ${errorMessage} the role!`,
            ephemeral: true
        });
    }
}

// 
//  ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ 
//  ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ
//  ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ ФИЛЬТРАЦИЯ КАНАЛОВ
// 


class CreativeChannelsFilter {
    constructor(config) {
        this.config = config;
    }

    getChannelConfig(msg) {
        return this.config.channels.find(ch => ch.chatId === msg.channelId);
    }

    isCorrectGuildAndChannel(msg) {
        return msg.guildId === this.config.guildId && this.config.channels.some(ch => ch.chatId === msg.channelId);
    }

    isAttachmentRight(msg, fileTypes) {
        if (msg.attachments.size === 0) return false;
        return msg.attachments.some(att => att.contentType && fileTypes.includes(att.contentType.split('/')[0]));
    }

    isIncludesCorrectLinks(msg, domains, checkExternalPngLink) {
        const externalSources = new RegExp(`(${domains.join('|')})[^\\s]*`, 'i');
        if (checkExternalPngLink) {
            const linkAttachments = /https:\/\/[^\s]*\.png/i;
            return externalSources.test(msg.content) || linkAttachments.test(msg.content);
        }
        return externalSources.test(msg.content);
    }

    async isLastMessageSameAuthor(msg) {
        const twoLastMsg = await msg.channel.messages.fetch({ limit: 2 });
        const previousMsgAuthorId = twoLastMsg.last().author.id;
        return previousMsgAuthorId === msg.author.id;
    }

    async sendWarning(msg) {
        try {
            await msg.delete();
            if (this.config.lang === "ru") {
                await msg.author.send(phrases.commentDeleted(msg).ru);
            } else {
                await msg.author.send(phrases.commentDeleted(msg).en);
            }
        } catch (error) {
            console.error(`Error in sendWarning: ${error}`);
        }
    }

    async createThread(msg) {
        try {
            if (this.config.lang === "ru") {
                await msg.startThread({
                    name: 'Комментарии',
                    autoArchiveDuration: 60,
                    reason: 'Созданно автоматически',
                });
            } else {
                await msg.startThread({
                    name: 'Comments',
                    autoArchiveDuration: 60,
                    reason: 'Auto created',
                });
            }
        } catch (error) {
            console.error(`Error creating thread: ${error}`);
        }
    }

    async addRatingReaction(msg, isCreate) {
        try {
            if (isCreate === true) {
                await msg.react('2️⃣');
                await msg.react('3️⃣');
                await msg.react('4️⃣');
                await msg.react('5️⃣');
            } else {
                return
            }
        } catch (error) {
            console.error(`Add reaction error: ${error}`);
        }
        
    }

    async handleMessage(msg) {
        if (!this.isCorrectGuildAndChannel(msg)) return;

        const chConfig = this.getChannelConfig(msg);
        if (!chConfig) return;

        if (this.isAttachmentRight(msg, chConfig.fileTypes) || this.isIncludesCorrectLinks(msg, chConfig.domains, chConfig.checkExternalPngLink)) {
            await this.createThread(msg);
            await this.addRatingReaction(msg, chConfig.rating);
            debug('Chat validation passed, create thread')
        } else if (!await this.isLastMessageSameAuthor(msg)) {
            await this.sendWarning(msg);
            debug('Chat validation NOT passed, deleted the message and sent warning to user')
        }
    }
}



const twitterAutoChange = async (msg) => {
    if (msg.author.bot) {
        return
    }
    const guildConfig = channelConfigs.filter(guild => guild.guildId === msg.guildId)[0];
    if (!guildConfig) return; 
    
    const blackList = [...guildConfig.twitterAutoChangeBlackList, ...guildConfig.channels.map(chId => chId.chatId)]
    
    if (guildConfig.isTwitterAutoChange === true && !blackList.includes(msg.channelId)) {
        if (/https:\/\/x\.com\/\S+/.test(msg.content)) {

            // --- Блок проверки API ---
            const match = msg.content.match(/x\.com\/[a-zA-Z0-9_]+\/status\/([0-9]+)/);
            if (match && match[1]) {
                const tweetId = match[1];
                try {
                    const apiResponse = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`);
                    const data = await apiResponse.json();
                    const hasVideoOrGif = data.media_extended && data.media_extended.some(media => media.type === 'video' || media.type === 'gif');

                    if (!hasVideoOrGif) {
                        return; 
                    }
                } catch (error) {
                    console.error("Ошибка при проверке API vxtwitter:", error);
                    return; 
                }
            }
            // -------------------------

            // Удаляем сообщение
            await msg.delete().catch(err => console.error("Ошибка при удалении:", err));

            // Задержка 500 мс
            await new Promise(resolve => setTimeout(resolve, 500));

            const linkMatch = msg.content.match(/https:\/\/x\.com\/\S+/g);
            let userText = msg.content;
            let updatedLink = "";
            let pingsToSend = ""; 

            // Обработка упоминаний
            if (msg.mentions.members.size > 0) {
                // Собираем реальные пинги для второго сообщения
                pingsToSend = msg.mentions.members.map(member => member.toString()).join(" ");

                // [ИЗМЕНЕНО] Заменяем тег на чистый ник (displayName) без @ и жирного шрифта
                msg.mentions.members.forEach(member => {
                    const mentionRegex = new RegExp(`<@!?${member.id}>`, 'g');
                    userText = userText.replace(mentionRegex, member.displayName); // [ИЗМЕНЕНО] Убран @ и **
                });
            }

            if (linkMatch) {
                updatedLink = linkMatch[0].replace(/https:\/\/x\.com\/(\S+)/, "https://vxtwitter.com/$1");
                userText = userText.replace(/https:\/\/x\.com\/\S+/g, "").trim(); 
                userText = userText.replace(/\s+/g, " ").trim(); 
                if (!userText) userText = ""; 
            }

            // Собираем основное сообщение
            const newMessage = userText
                ? `<@${msg.author.id}>\n${userText}\n${updatedLink}` 
                : `<@${msg.author.id}>\n${updatedLink}`;




            // Отправляем сообщение с видео
            await msg.channel.send({
                content: newMessage,
                allowedMentions: { parse: [] } 
            }).catch(err => console.error("Ошибка при отправке:", err));

            // Отправляем пинги вторым сообщением
            if (pingsToSend) {
                await msg.channel.send({
                    content: pingsToSend,
                    allowedMentions: { parse: ['users'] }
                }).catch(err => console.error("Ошибка при отправке пингов:", err));
            }



            debug('Auto change twitter link (Mentions replaced with plain names)')
        }
    }
}

// Создание фильтров из конфигов для фильтрации каналов
const filters = channelConfigs.map(config => new CreativeChannelsFilter(config));

//Кик тех кого взломали и начался спам в чат (6 сообщения с промеждутком меньше 60 сек)
const userActivity = new Map();
const autoKickSpam = async (msg) => {

    // Пропускаем сообщения от ботов и не в гильдиях
    if (msg.author.bot || !msg.guild || getServerConfig(msg).autoBanSpam === false) return;

    const guildId = msg.guild.id;
    const userId = msg.author.id;
    const channelId = msg.channel.id;
    const currentTime = Date.now();

    // Инициализируем хранилище для сервера
    if (!userActivity.has(guildId)) {
        userActivity.set(guildId, new Map());
    }

    const guildUsers = userActivity.get(guildId);
    
    // Получаем или создаем запись активности пользователя
    if (!guildUsers.has(userId)) {
        guildUsers.set(userId, {
            channels: new Set(),
            lastMessageTime: currentTime,
            timer: setTimeout(() => guildUsers.delete(userId), 60000)
        });
    }

    const userData = guildUsers.get(userId);
    
    // Обновляем данные активности
    userData.channels.add(channelId);
    userData.lastMessageTime = currentTime;

    // Проверяем условия спама
    if (userData.channels.size >= 4) {
        debug(`<@${msg.author.id}> (${msg.member.displayName}) USER WAS BANNED FROM "${msg.guild.name}" SERVER FOR SPAM`)
        await sendMsgToAdmin(`<@${msg.author.id}> was banned from "${msg.guild.name}" server`)
        try {
            if (getServerLang(msg) === "ru") {
                await msg.author.send(phrases.kickForSpam(msg).ru);
            } else {
                await msg.author.send(phrases.kickForSpam(msg).en);
            }
        } catch (error) {
            console.error(`Error in send kick for spam message: ${error}`);
            await sendMsgToAdmin(`<@${msg.author.id}> was banned from "${msg.guild.name}" server`)
        }
        // Очищаем данные пользователя после обнаружения
        clearTimeout(userData.timer);
        guildUsers.delete(userId);

        //Баним с сервера 
        try {
            if (getServerLang(msg) === "ru") {
                await msg.member.ban({
                    reason: 'Автобан за спам более 6 одинаковых сообщений в разных чатах (вероятно аккаунт взломали)',
                    deleteMessageSeconds: 60 * 10 // сообщения за последные 10 минут удалены
                });
            } else {
                await msg.member.ban({
                    reason: 'Autoban for spamming more than 6 identical messages in different chats (probably hacked)',
                    deleteMessageSeconds: 60 * 10 // сообщения за последные 10 минут удалены
                });
            }

        } catch (error) {
            console.error('Ошибка при бане:', error);
        }
    }
}


client.on('ready', async () => {
    debug('Bot started')
    await registerCommands(client); //регает слеш команды при запуске
    await sendMsgToAdmin('Bot started')

    //статус 
    client.user.setPresence({
        activities: [{ name: 'chwop-chwop', type: 4 }], // Type 4 for custom
        status: 'online'
    });
  
    //описание
    //await client.application.edit({ description: 'Automatic spam removal and automatic thread creation in creative channels. Autoban spam hack, text-to-voice in voice channels, embed messages, and button-based role assignment.' });
});

client.on('messageCreate', async (msg) => {
    // Фильтрация каналов
    for (const filter of filters) {
        await filter.handleMessage(msg);
    }
    twitterAutoChange(msg)
    autoKickSpam(msg)
    executeVoiceTTS(msg)
});

client.login(env.token);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});


