const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);
var parse = require('parse-link-header');
const fs = require('fs');
var glob = require("glob")

const app = express();
app.use(logger(`dev`));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

// Uncomment to print out contents of requests
// app.use(function (req, res, next) {
//     console.log("Request: ", req);
//     next();
// });

app.get(`/logo`, (req, res) => res.sendFile(path.resolve(__dirname, `logo.svg`)));

const appConfig = require(`./config.app.json`);
app.get(`/`, (req, res) => res.json(appConfig));

app.post(`/validate`, (req, res) => res.json({name: `Public`}));

app.get(`/api/v1/synchronizer/clearcache`, (req, res) => {
    glob("**/*.literature.txt", function (er, files) {
        for (const file of files) {
            fs.unlinkSync(file);
        }
    });
    glob("**/*.author.txt", function (er, files) {
        for (const file of files) {
            fs.unlinkSync(file);
        }
    });

});

const syncConfig = require(`./config.sync.json`);
app.post(`/api/v1/synchronizer/config`, (req, res) => res.json(syncConfig));

const schema = require(`./schema.json`);
app.post(`/api/v1/synchronizer/schema`, (req, res) => res.json(schema));

app.post(`/api/v1/synchronizer/data`, wrap(async (req, res) => {
    var {requestedType, filter, pagination, account} = req.body;
    
    if (_.isEmpty(filter.libraryid)) {
        throw new Error(`Library ID must be specified`);
    }

    if (requestedType != `literature` && requestedType != `author`) { 
        throw new Error(`Only literature and author databases can be synchronized`);
    }

    const {libraryid} = filter;
    const filename = libraryid + "." + account["owner"] + "." + requestedType + ".txt";
    console.log(filename, req.body);
    var synchronizationType = "delta";

    var url = `https://api.zotero.org/groups/${libraryid}/items/top`;

    if (pagination != null && pagination["link"] != null) {
        url = pagination["link"];
        synchronizationType = pagination["synchronizationType"];
    } else if (pagination == null) {
        pagination = {};
        try {
            const version = fs.readFileSync(path.resolve(__dirname, filename), 'utf8');
            console.log(version);
            url += `?since=${version}`;
          } catch (err) {
            console.error(err);
            synchronizationType = "full";
          }
    
    }

    var items = [];
    response = await (got(url));
        
    if (requestedType == `literature`) {
        for (item of JSON.parse(response.body)) {
            data = item.data;
            // data.bibtex = (await got(`https://api.zotero.org/groups/${libraryid}/items/${item.key}?format=bibtex`)).body;
            data.id = uuid(JSON.stringify(item.key));
            data.name = data.title;
            data.link = item.links.alternate.href;
            data.key = item.key;
            data.authorId = [];
            for (a of data.creators) {
                if (a.creatorType != "author") {
                    continue;
                }
                a.firstName = a.firstName.split(" ")[0];
                a.name = a.firstName + " " + a.lastName;
                a.id = uuid(JSON.stringify(a.name));
                data.authorId.push(a.id);
            }
            data.__syncAction = "SET";
            items.push(data);
        };
    } else if (requestedType == `author`) {
        items = {};

        for (item of JSON.parse(response.body)) {
            for (a of item.data.creators) {
                if (a.creatorType != "author") {
                    continue;
                }
                a.firstName = a.firstName.split(" ")[0];
                a.name = a.firstName + " " + a.lastName;
                a.id = uuid(JSON.stringify(a.name));
                if (!(a.name in items)) {
                    items[a.name] = a;
                    items[a.name].__syncAction = "SET";
                }
                
            }

        }
    }

    var parsed = parse(response.headers.link);

    pagination["hasNext"] = parsed["next"] != null;
    if (pagination["hasNext"]) {
        pagination["nextPageConfig"] =  {
            "link": parsed["next"]["url"]
            };
    }  else {
        // We've finished syncing this version
        // Let's record its number
        fs.writeFile(path.resolve(__dirname, filename), response.headers["last-modified-version"], err => {
            if (err) {
                console.error(err);
            }
            // file written successfully
            });
    }

    return res.json({items, pagination, synchronizationType});
    
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
