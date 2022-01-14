const request = require(`supertest`);
const app = require(`./app`);
const assert = require(`assert`);

describe(`integration app suite`, function () {
    it(`should have the logo`, async () => {
        await request(app).get(`/logo`).expect(200).expect(`Content-Type`, /svg/);
    });

    it(`should have app config`, async () => {
        const {body: appConfig} = await request(app).get(`/`)
            .expect(200).expect(`Content-Type`, /json/);

        assert.equal(appConfig.name, `Public Holidays`);
        assert.equal(appConfig.version, `1.0.0`);
        assert.match(appConfig.description, /public holidays/);
        assert.equal(appConfig.responsibleFor.dataSynchronization, true);
    });

    it(`should have validate end-point`, async () => {
        const {body: {name}} = await request(app).post(`/validate`)
            .expect(200).expect(`Content-Type`, /json/);
        assert.equal(name, `date.nager.at`);
    });

    it(`should have synchronization config`, async () => {
        const {body: {types, filters}} = await request(app).post(`/api/v1/synchronizer/config`)
            .expect(200).expect(`Content-Type`, /json/);
        assert.equal(types.length, 1);
        assert.equal(filters.length, 3);
    });

    it(`should have schema holidays type defined`, async () => {
        const {body: {schema: {holidays}}} = await request(app).post(`/api/v1/synchronizer/schema`)
            .expect(200).expect(`Content-Type`, /json/);
        assert.deepEqual(holidays.id, {name: `Id`, type: `id`});
    });

    it(`should return data for CY`, async () => {
        const {body: {items}} = await request(app).post(`/api/v1/synchronizer/data`).send({
            requestedType: `holidays`,
            filter: {
                countries: [`CY`]
            }
        }).expect(200).expect(`Content-Type`, /json/);
        assert.equal(items.length > 0, true);
    });
});
