const twitter = [
    'https://x.com', 
    'https://twitter.com', 
    'https://fxtwitter.com', 
    'https://vxtwitter.com', 
    'https://fixupx.com', 
    'https://hitlerx.com', 
    'https://fixvx.com',
    'https://girlcockx.com',
    'https://cunnyx.com',
    'https://stupidpenisx.com']

const youtube = [
    'https://youtu.be', 
    'https://www.youtube.com']

const audiostriming = [
    'https://soundcloud.com/', 
    'https://open.spotify.com/', 
    'https://band.link/', 
    'https://music.yandex.ru', 
    'https://www.beatstars.com']

const art = [
    'https://www.deviantart.com/', 
    'https://www.artstation.com/', 
    'https://www.instagram.com/', 
    'https://dribbble.com/', ]


const channelConfigs = [
    {
        serverName: 'Library тестовый сервер',
        guildId: '1016342174058696824',
        lang: 'en',
        isTwitterAutoChange: true,
        twitterAutoChangeBlackList: ['1016361436764700802'],
        autoBanSpam: true,
        channels: [
            {
                chatname: "Тестовый чат",
                chatId: '1404090860576182312',
                fileTypes: ['image', 'video','audio'],
                checkExternalPngLink: true,
                domains: [...twitter, ...youtube, ...art, ...audiostriming],
                rating: false
            },
        ]
    },
    {
        serverName: 'Motiparty сервер жана',
        guildId: '952571466556248114',
        lang: 'en',
        isTwitterAutoChange: true,
        twitterAutoChangeBlackList: ['952572540990148739', '952573062816083968', '952586290979811338'],
        autoBanSpam: true,
        channels: [
            {
                chatname: "art-workshop",
                chatId: '952581549746958396',
                fileTypes: ['image', 'video'],
                checkExternalPngLink: true,
                domains: [...twitter, ...youtube, ...art],
                rating: false
            },
            {
                chatname: "audio-workshop",
                chatId: '1155979525503590481',
                fileTypes: ['audio', 'video'],
                checkExternalPngLink: false,
                domains: [...youtube, ...twitter, ...audiostriming],
                rating: false
            },
            {
                chatname: "photo-workshop",
                chatId: '952581777669648384',
                fileTypes: ['image', 'video'],
                checkExternalPngLink: true,
                domains: [...twitter, ...youtube, ...art],
                rating: false
            }
        ]
    },
    {
        serverName: 'Iy beats',
        guildId: '472455740997763072',
        lang: 'ru',
        isTwitterAutoChange: true,
        twitterAutoChangeBlackList: ['707666323731382312', '905152117575127080', ],
        autoBanSpam: true,
        channels: [
            {
                chatname: "ваше-творчество (готовые работы любого типа)",
                chatId: '926574472507564032',
                fileTypes: ['image', 'video', 'audio'],
                checkExternalPngLink: true,
                domains: [...twitter, ...youtube, ...art, ...audiostriming],
                rating: true
            },
            {
                chatname: "оценка-демок (только для демок)",
                chatId: '707682658968404018',
                fileTypes: ['audio', 'video'],
                checkExternalPngLink: false,
                domains: [...youtube, ...twitter, ...audiostriming],
                rating: true
            }
        ]
    },
    {
        serverName: 'Летофаги',
        guildId: '369101787556478976',
        lang: 'ru',
        isTwitterAutoChange: true,
        twitterAutoChangeBlackList: ['нет'],
        autoBanSpam: true,
        channels: []
    },
];

export default channelConfigs
