import { HttpException } from '@nestjs/common';
import { NumericIdPipe } from './numeric-id.pipe.js';

const pipe = new NumericIdPipe();

/**
 * known-bugs #14. The interesting cases are not the obviously-bad ones but the
 * *nearly*-good ones: `parseInt` accepts all of `'1x'`, `' 1'`, `'+1'` and
 * `'1.5'`, and a lenient check would have quietly served user 1 for every one
 * of them.
 */
describe('NumericIdPipe', () => {
  it.each(['1', '42', '0', '999999'])('accepts %o unchanged', (value) => {
    // Returned as a string: every repository takes ids as strings and passes
    // them to parameterised SQL, so coercing here would buy nothing.
    expect(pipe.transform(value)).toBe(value);
  });

  it.each([
    'abc',
    '1x',
    'x1',
    ' 1',
    '1 ',
    '+1',
    '-1',
    '1.5',
    '1e3',
    '',
    '007',
    '9999999999999999999999',
  ])('rejects %o', (value) => {
    try {
      pipe.transform(value);
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(400);
      expect((thrown as HttpException).getResponse()).toEqual({
        error: 'Invalid id.',
      });
      return;
    }
    throw new Error(`expected ${JSON.stringify(value)} to be rejected`);
  });

  it('rejects a very large integer rather than truncating it', () => {
    // Past Number.MAX_SAFE_INTEGER: allowing it would hand Postgres a value
    // that overflows int4 and produce the 500 this pipe exists to prevent.
    expect(() => pipe.transform('9999999999999999999999')).toThrow();
  });
});
