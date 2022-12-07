const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);

const app = express();
app.use(logger(`dev`));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.get(`/logo`, (req, res) => res.sendFile(path.resolve(__dirname, `logo.svg`)));

const appConfig = require(`./config.app.json`);
app.get(`/`, (req, res) => res.json(appConfig));

app.post(`/validate`, (req, res) => res.json({name: `Public`}));

const syncConfig = require(`./config.sync.json`);
app.post(`/api/v1/synchronizer/config`, (req, res) => res.json(syncConfig));

const schema = require(`./schema.json`);
app.post(`/api/v1/synchronizer/schema`, (req, res) => res.json(schema));

app.post(`/api/v1/synchronizer/data`, wrap(async (req, res) => {
    const {requestedType, filter} = req.body;

    if (requestedType == `literature`) {
        const items = [];
        const url = `https://api.zotero.org/groups/2836051/items/top`;
        response = await (got(url).json());
        
        response.forEach((item) => {
            data = item.data;
            data.id = uuid(JSON.stringify(data));
            data.name = data.title;
            data.link = item.links.alternate.href;
            data.key = item.key;
            items.push(data);
        });


        return res.json({items});

    } else if (requestedType == `author`) {
        const items = {};
        const url = `https://api.zotero.org/groups/2836051/items/top`;
        (await (got(url).json())).forEach((item) => {
            for (a of item.data.creators) {
                author = a;
                if (author.creatorType != "author") {
                    continue;
                }
                author.firstName = author.firstName.split(" ")[0];
                author.name = author.firstName + " " + author.lastName;
                author.id = uuid(JSON.stringify(author));
                if (author.name in items) {
                    items[author.name].works.push(uuid(JSON.stringify(data)));
                } else {
                    items[author.name] = author;
                    items[author.name].works = [uuid(JSON.stringify(data))];
                }
                
            }

        });

        return res.json({items});
    }

    throw new Error(`Only literature and author databases can be synchronized`);
}));

app.use(function (req, res, next) {
    const error = new Error(`Not found`);
    error.status = 404;
    next(error);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    console.log(err);
    res.json({message: err.message, code: err.status || 500});
});

module.exports = app;
