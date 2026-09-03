import { configuration, parseEnv, validate } from './configuration.js';

const minimal = {
  JWT_SECRET: 's3cret',
  DB_HOST: 'localhost',
  DB_NAME: 'class_reunion',
  DB_USER: 'postgres',
  DB_PASSWORD: 'testpass',
};

describe('environment validation', () => {
  it('accepts a minimal local configuration and applies defaults', () => {
    const env = parseEnv(minimal);

    expect(env.PORT).toBe(5001);
    expect(env.DB_PORT).toBe(5432);
    expect(env.DB_CONNECT_TIMEOUT_MS).toBe(30000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.FEEDBACK_ENABLED).toBe('true');
  });

  it('rejects a missing JWT_SECRET rather than falling back to a default', () => {
    const { JWT_SECRET, ...withoutSecret } = minimal;

    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('reports every problem at once, not just the first', () => {
    expect(() => parseEnv({ DB_NAME: 'class_reunion' })).toThrow(
      /JWT_SECRET[\s\S]*DB_HOST/,
    );
  });

  it('requires DB credentials when DATABASE_SECRET_ARN is absent', () => {
    const { DB_USER, DB_PASSWORD, ...noCreds } = minimal;

    expect(() => parseEnv(noCreds)).toThrow(/DB_USER/);
  });

  it('makes DB credentials optional when DATABASE_SECRET_ARN is set', () => {
    const { DB_USER, DB_PASSWORD, ...noCreds } = minimal;

    const env = parseEnv({
      ...noCreds,
      DATABASE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:db',
    });

    expect(env.DB_USER).toBeUndefined();
  });

  it('coerces numeric vars from their string environment form', () => {
    const env = parseEnv({ ...minimal, PORT: '8080', DB_PORT: '15432' });

    expect(env.PORT).toBe(8080);
    expect(env.DB_PORT).toBe(15432);
  });

  it('preserves unrelated environment keys through validate()', () => {
    const result = validate({ ...minimal, PATH: '/usr/bin', HOME: '/root' });

    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/root');
    expect(result.PORT).toBe(5001);
  });
});

describe('configuration factory', () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  it('maps the environment onto the typed config shape', () => {
    process.env = { ...original, ...minimal } as NodeJS.ProcessEnv;

    const config = configuration();

    expect(config.jwtSecret).toBe('s3cret');
    expect(config.database).toMatchObject({
      host: 'localhost',
      name: 'class_reunion',
      user: 'postgres',
      port: 5432,
      connectTimeoutMs: 30000,
    });
  });

  it('treats only the literal string "false" as disabling feedback', () => {
    process.env = {
      ...original,
      ...minimal,
      FEEDBACK_ENABLED: 'false',
    } as NodeJS.ProcessEnv;
    expect(configuration().feedbackEnabled).toBe(false);

    process.env = { ...original, ...minimal } as NodeJS.ProcessEnv;
    expect(configuration().feedbackEnabled).toBe(true);
  });
});
