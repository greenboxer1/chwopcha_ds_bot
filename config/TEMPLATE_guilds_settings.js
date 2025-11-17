const channelConfigs = [
    {
        serverName: 'server', // To make it easier to understand the config
        guildId: 'guild id', // Server id
        lang: 'en', // Messages language 'en' or 'ru'
        isTwitterAutoChange: true, // Auto change twitter links on vxtwitter
        twitterAutoChangeBlackList: ['123'], // An array of chat IDs where twitter autho change should not work.
        autoBanSpam: true, // Auto ban hacked users who spam in more than 6 channels per 60 seconds

        // Walidation for creative channels (auto delete messages and create threads)
        channels: [
            {
                chatname: 'chatname', // To make it easier to understand the config
                chatId: '123', // Chat id
                fileTypes: ['image', 'video','audio'], // What type of content should not be deleted in this chat
                checkExternalPngLink: true, // Do not delete messages with picture links
                domains: ['https://www.youtube.com/','https://x.com/'], // Array of domain names of links that are shoud not removed
                rating: false // Adds reactions of numbers from 2 to 5 for evaluating works
            },
        ]
    },
];

export default channelConfigs