const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const appConfig = require(`./config.app.json`);
const syncConfig = require(`./config.sync.json`);
const schema = require(`./schema.json`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);

const getYearRange = filter => {
    let fromYear = parseInt(filter.from);
    let toYear = parseInt(filter.to);

    if (_.isNaN(fromYear)) {
        fromYear = new Date().getFullYear() - 1;
    }
    if (_.isNaN(toYear)) {
        toYear = new Date().getFullYear();
    }
    const yearRange = [];
    while(fromYear <= toYear) {
        yearRange.push(fromYear);
        fromYear++;
    }
    return yearRange;
};

const app = express();
app.use(logger(`dev`));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

app.get(`/logo`, (req, res) => res.sendFile(path.resolve(__dirname, `logo.svg`)));

app.get(`/`, (req, res) => {
    res.json(appConfig);
});

app.post(`/validate`, (req, res) => {
    res.json({name: `Public`});
});

app.post(`/api/v1/synchronizer/config`, (req, res) => {
    res.json(syncConfig);
});

app.post(`/api/v1/synchronizer/schema`, (req, res) => {
    res.json(schema);
});

app.post(`/api/v1/synchronizer/datalist`, wrap(async (req, res) => {
    const items = (await (got(`https://date.nager.at/api/v3/AvailableCountries`).json()))
        .map((row) => ({title: row.name, value: row.countryCode}));
    res.json({items});
}));

app.post(`/api/v1/synchronizer/data`, wrap(async (req, res) => {
    const {requestedType, filter} = req.body;
    if (requestedType !== `holiday`) {
        throw new Error(`Only holidays database can be synchronized`);
    }
    if (_.isEmpty(filter.countries)) {
        throw new Error(`Countries filter should be specified`);
    }
    const {countries} = filter;
    const yearRange = getYearRange(filter);
    const items = [];
    for (const country of countries) {
        for (const year of yearRange) {
            const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
            console.log(url);
            (await (got(url).json())).forEach((item) => {
                item.id = uuid(JSON.stringify(item));
                items.push(item);
            });
        }
    }
    return res.json({items});
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
