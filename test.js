const request = require('supertest');
const app = require('./app');

describe('integration app suite', function () {
    it('should have the logo', async () => {
        await request(app).get('/logo.svg').expect(200);
    });
});
