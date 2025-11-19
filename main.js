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
    AudioPlayerStatus
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

//Мои вспомогательные функции
const dateNow = () => {
    const now = new Date();
    const padZero = (num) => num < 10 ? `0${num}` : num;
    return `${padZero(now.getDate())}.${padZero(now.getMonth() + 1)}.${now.getFullYear()} (${padZero(now.getHours())}:${padZero(now.getMinutes())})`;
}

const getServerConfig = (msg) => {
    return channelConfigs.filter(guild => guild.guildId === msg.guildId)[0]
}

const getServerLang = (msg) => {
    return getServerConfig(msg).lang
}

const debug = (consoleMsg) => {
    console.log(`[${dateNow()}] ${consoleMsg}`)
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

const FFMPEG_COMMAND = process.platform === 'win32' ? ffmpegPath : 'ffmpeg'; //!!! для линукса apt install ffmpeg !!! использует локальный ффмпег для винды и глобальный для линукс

function playStream(url, guildId, speechSpeed) {
    const player = guildPlayers.get(guildId);
    if (!player) return;

    const ffmpegProcess = spawn(FFMPEG_COMMAND, [
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-i', url,
        '-filter:a', `atempo=${speechSpeed}`,
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '1',
        'pipe:1'
    ]);

    const resource = createAudioResource(ffmpegProcess.stdout, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });


    //Логирование ошибок ffmpeg разкомментируй если опять хуйня начнется
    // ffmpegProcess.stderr.on('data', (data) => {
    //     // Показываем все, что FFmpeg говорит в stderr
    //     console.error(`FFMPEG ERROR [${guildId}]: ${data.toString()}`); 
    // });

    // ffmpegProcess.on('close', (code) => {
    //     if (code !== 0) {
    //         console.error(`FFMPEG PROCESS CLOSED WITH ERROR CODE ${code} on guild ${guildId}`);
    //     }
    // });

    player.play(resource);
}

function playNextInQueue(guildId) { 
    const queueData = guildQueues.get(guildId);
    
    if (!queueData || queueData.queue.length === 0) return;
    
    const nextUrl = queueData.queue.shift();
    const speechSpeed = queueData.speechSpeed;

    playStream(nextUrl, guildId, speechSpeed); 
}

const SPEECH_SPEEDS = {
    'ru': '1.5',
    'en': '1.4'  
}; 

const guildPlayers = new Map(); 
const guildQueues = new Map();

async function executeVoiceTTS(message) {
    const guildId = message.guild.id;

    // 1. Проверки
    if (message.author.bot || !message.content) return;
    if (message.channel.type !== ChannelType.GuildVoice) return;
    
    // 2. ПОЛУЧАЕМ ЯЗЫК СЕРВЕРА И СКОРОСТЬ
    const lang = getServerLang(message); 
    const speechSpeed = SPEECH_SPEEDS[lang] || SPEECH_SPEEDS['ru']; 

    try {
        // 3. Инициализация плеера для этого сервера
        let player = guildPlayers.get(guildId);
        // Если плеер не существует, создаем его и настраиваем слушатели
        if (!player) {
            player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
            });
            guildPlayers.set(guildId, player); 

            // Настраиваем слушатель (Idle) для НОВОГО плеера
            player.on(AudioPlayerStatus.Idle, () => {
                playNextInQueue(guildId);
            });
            player.on('error', error => {
                console.error(`Audio Player Error [${guildId}]:`, error.message);
            });
        }
        
        // 4. Очистка и подготовка
        // Очищаем старую очередь и останавливаем плеер (если его перебили)
        guildQueues.set(guildId, {
            queue: [], // Очищаем очередь
            lang: lang, 
            speechSpeed: speechSpeed
        });
        player.stop();    
        
        // Получаем объект очереди
        let queueData = guildQueues.get(guildId);

        // 5. Подключение к каналу
        const connection = joinVoiceChannel({
            channelId: message.channel.id,
            guildId: guildId,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: true,
        });
        connection.subscribe(player); 

        // 6. Разбиение длинного текста и заполнение очереди
        const results = googleTTS.getAllAudioUrls(message.content, {
            lang: lang, 
            slow: false,
            host: 'https://translate.google.com',
        });

        // Заполняем массив URL в объекте очереди
        queueData.queue.push(...results.map(item => item.url));

        // 7. Ставим реакцию и запускаем чтение
        await message.react('❌');
        playNextInQueue(guildId);

    } catch (error) {
        console.error(`TTS Error [${guildId}]:`, error.message);
    }
}

// Обработка нажатия на крестик (кнопка "Стоп")
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== '❌') return;

    const guildId = reaction.message.guild.id;
    const player = guildPlayers.get(guildId);
    const queueData = guildQueues.get(guildId);

    // Останавливаем, только если плеер и очередь существуют для этого сервера
    if (player && queueData) {
        queueData.queue.length = 0; // Очищаем очередь
        player.stop();    // Останавливаем текущее воспроизведение
        
        // Опционально: удаляем реакцию, чтобы кнопка не выглядела нажатой
        try {
            await reaction.users.remove(user.id);
        } catch (e) {
            console.error('Не удалось удалить реакцию:', e);
        }
        
        console.log(`Пользователь ${user.username} остановил чтение на сервере ${reaction.message.guild.name}.`);
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
        console.log('Started refreshing application (/) commands for all guilds.');
        
        // Получаем все серверы где находится бот
        const guilds = client.guilds.cache;
        const registerPromises = [];

        for (const [guildId, guild] of guilds) {
            console.log(`Registering commands for guild: ${guild.name} (${guildId})`);
            
            const promise = rest.put(
                Routes.applicationGuildCommands(env.clientId, guildId),
                { body: commands }
            ).catch(error => {
                console.error(`Failed to register commands for guild ${guild.name} (${guildId}):`, error);
            });
            
            registerPromises.push(promise);
        }

        await Promise.all(registerPromises);
        console.log(`Successfully registered commands for ${guilds.size} guilds.`);
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
    if (interaction.customId === 'embed_modal') {
        const title = interaction.fields.getTextInputValue('embed_title');
        const description = interaction.fields.getTextInputValue('embed_description');
        const color = interaction.fields.getTextInputValue('embed_color');
        const image = interaction.fields.getTextInputValue('embed_image');
        const thumbnail = interaction.fields.getTextInputValue('embed_thumbnail');

        // Создаем эмбед
        const embed = new EmbedBuilder()
            .setDescription(description);

        // Добавляем опциональные поля если они есть
        if (title) embed.setTitle(title);
        if (color) {
            // Конвертируем HEX в число
            const hexColor = color.replace('#', '');
            embed.setColor(parseInt(hexColor, 16));
        } else {
            // Цвет по умолчанию, если не указан
            embed.setColor(0x0099FF);
        }
        if (image) embed.setImage(image);
        if (thumbnail) embed.setThumbnail(thumbnail);

        try {
            // Отправляем эмбед как обычное сообщение в канал
            await interaction.channel.send({ embeds: [embed] });
            
            // Отправляем подтверждение пользователю (эпиhemeral)
            await interaction.reply({
                content: 'Эмбед успешно отправлен в канал!',
                ephemeral: true
            });
        } catch (error) {
            console.error('Ошибка при отправке эмбеда:', error);
            await interaction.reply({
                content: 'Произошла ошибка при отправке эмбеда. Убедитесь, что у бота есть права на отправку сообщений в этот канал.',
                ephemeral: true
            });
        }
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
        } else if (!await this.isLastMessageSameAuthor(msg)) {
            await this.sendWarning(msg);
        }
    }
}



const twitterAutoChange = async (msg) => {
    if (msg.author.bot) {
        return
    }
    const guildConfig = channelConfigs.filter(guild => guild.guildId === msg.guildId)[0];
    const blackList = [...guildConfig.twitterAutoChangeBlackList, ...guildConfig.channels.map(chId => chId.chatId)]
        if (guildConfig.isTwitterAutoChange === true &&  !blackList.includes(msg.channelId)) {
            if (/https:\/\/x\.com\/\S+/.test(msg.content)) {
                // Удаляем сообщение
                await msg.delete().catch(err => console.error("Ошибка при удалении:", err));

                // Задержка 500 мс
                await new Promise(resolve => setTimeout(resolve, 500));

                // Извлекаем ссылку
                const linkMatch = msg.content.match(/https:\/\/x\.com\/\S+/g);
                let userText = msg.content;
                let updatedLink = "";

                if (linkMatch) {
                    // Заменяем ссылку на vxtwitter.com
                    updatedLink = linkMatch[0].replace(/https:\/\/x\.com\/(\S+)/, "https://vxtwitter.com/$1");

                    // Убираем ссылку из текста
                    userText = msg.content.replace(/https:\/\/x\.com\/\S+/g, "").trim();
                    if (!userText) userText = ""; // Если текста нет, оставляем пустую строку
                }

                // Собираем новое сообщение в порядке: ник → текст → ссылка
                const newMessage = userText
                    ? `<@${msg.author.id}>\n${userText}\n${updatedLink}` // Если есть текст, добавляем его между ником и ссылкой
                    : `<@${msg.author.id}>\n${updatedLink}`; // Если текста нет, только ник и ссылка

                // Отправляем новое сообщение
                msg.channel.send({
                    content: newMessage,
                    allowedMentions: { parse: [] } // Отключаем пинг
                }).catch(err => console.error("Ошибка при отправке:", err));
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
    if (userData.channels.size >= 6) {
        //Отправка уведомления о бане с сервера 
        try {
            if (getServerLang(msg) === "ru") {
                await msg.author.send(phrases.kickForSpam(msg).ru);
            } else {
                await msg.author.send(phrases.kickForSpam(msg).en);
            }
            await sendMsgToAdmin(`<@${msg.userId}> was banned from "${msg.guild.name}" server`)
        } catch (error) {
            console.error(`Error in send kick for spam message: ${error}`);
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


client.once('ready', async () => {
    console.log('Bot is ready!');
    await registerCommands(client); //регает слеш команды при запуске
    await sendMsgToAdmin('Bot started')
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


