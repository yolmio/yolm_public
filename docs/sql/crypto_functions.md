---
title: Crypto Functions
description: Cryptographic SQL functions for encryption, hashing, HMAC, password hashes, secure random bytes, and Base32 encoding.
tags:
  - sql
  - functions
  - security
---

# Crypto Functions

## Accepted Names

Most crypto functions are available in the `crypto.*` namespace and some also
have unqualified aliases:

| Function | Aliases | Returns |
| --- | --- | --- |
| `crypto.sha256(value)` | `sha256(value)`, `digest(value, 'sha256')` | `bytes` |
| `crypto.blake3(value)` | `blake3(value)` | `bytes` |
| `crypto.md5(value)` | `md5(value)`, `digest(value, 'md5')` | `bytes` |
| `crypto.hmac_sha256(message, key)` | `hmac_sha256(message, key)`, `hmac(message, key, 'sha256')` | `bytes` |
| `crypto.verify_hmac_sha256(message, key, signature)` | `verify_hmac_sha256(...)` | `bool` |
| `crypto.encrypt(value, key)` | `encrypt(value, key)` | `bytes` |
| `crypto.decrypt(value, key)` | `decrypt(value, key)` | `string` |
| `crypto.hash_password(password, salt)` | | `bytes` |
| `crypto.legacy_verify_password(password, hash, format)` | | `bool` |
| `crypto.random_bytes(length)` | `random.bytes(length)`, `random_bytes(length)`, `gen_random_bytes(length)` | `bytes` |
| `base32.encode(bytes)` | `base32_encode(bytes)` | `string` |
| `base32.decode(text)` | `base32_decode(text)` | `bytes` |

`crypto.encrypt`, `crypto.decrypt`, `crypto.legacy_*`, Base32, OTP/TOTP/HOTP,
QR, JWT, and network functions are server-only.

## Return Types

Most crypto functions return `bytes`. To use these values:

| To convert... | Use |
|---------------|-----|
| Bytes to hex string | `bytes.to_hex(value)` |
| Hex string to bytes | `bytes.from_hex(value)` |
| Bytes to UTF-8 string | `string.from_utf8(value)` |
| String to bytes | `string.to_utf8(value)` |

```sql
-- Hash returns bytes, convert to hex for display/storage
select bytes.to_hex(crypto.sha256('hello'));
-- '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

-- Decrypt returns string directly
select crypto.decrypt(encrypted_data, 'key');
-- 'original message'
```

## Encryption/Decryption

### crypto.encrypt

Encrypts data using a key derived from the provided key and a system-specific encryption key.

**Returns:** `bytes`

```sql
select crypto.encrypt('secret message', 'mypassword');
-- <bytes>

-- Store as hex in a string column
select bytes.to_hex(crypto.encrypt('secret', 'key'));
```

### crypto.decrypt

Decrypts data encrypted with crypto.encrypt.

**Returns:** `string`

```sql
select crypto.decrypt(encrypted_data, 'mypassword') from encrypted_messages;
-- 'secret message'

-- If stored as hex, convert first
select crypto.decrypt(bytes.from_hex(hex_encrypted), 'mypassword');
```

## Hashing

### crypto.sha256

Calculates the SHA256 hash of a value.

**Returns:** `bytes`

```sql
-- Returns bytes, use bytes.to_hex() for display
select bytes.to_hex(crypto.sha256('hello world'));
-- 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
```

### crypto.md5

Calculates the MD5 hash. **Do not use for security purposes - MD5 is insecure.**

**Returns:** `bytes`

```sql
select bytes.to_hex(crypto.md5('hello world'));
-- '5eb63bbbe01eeed093cb22bb8f5acdc3'
```

### crypto.blake3

Calculates the BLAKE3 hash. BLAKE3 is faster than SHA-256 while maintaining strong security properties.

**Returns:** `bytes`

```sql
select bytes.to_hex(crypto.blake3('hello world'));
```

## HMAC

### crypto.hmac_sha256

Calculates the HMAC-SHA256 of a message using a secret key.

**Returns:** `bytes`

```sql
select bytes.to_hex(crypto.hmac_sha256('input message', 'my secret key'));
-- '3deaa1fc26ab122fecad31c87c81d37d4e6bbd629e15c5c35e0df157cb6afa9c'
```

### crypto.verify_hmac_sha256

Verifies an HMAC-SHA256 signature.

**Returns:** `bool`

```sql
select crypto.verify_hmac_sha256(
  'input message',
  'my secret key',
  bytes.from_hex('3deaa1fc26ab122fecad31c87c81d37d4e6bbd629e15c5c35e0df157cb6afa9c')
);
-- true
```

## Password Hashing

### crypto.hash_password

Hashes a password using the argon2 algorithm.

**Returns:** `bytes`

```sql
-- Requires an explicit salt at least 8 bytes long
select crypto.hash_password('password', 'salt that is at least 8 bytes long');
-- <bytes>

-- Store as hex
select bytes.to_hex(crypto.hash_password('password', 'salt that is at least 8 bytes long'));
```

### crypto.legacy_verify_password

Verifies a password hash produced by a supported legacy format.

```sql
select crypto.legacy_verify_password(password_input, stored_hash, 'aspnet_identity_v2');
```

## Random

### crypto.random_bytes

Generates cryptographically secure random bytes of the specified length.

**Returns:** `bytes`

```sql
select crypto.random_bytes(16);
-- <16 random bytes>

-- Generate a random hex token
select bytes.to_hex(crypto.random_bytes(16));
-- 'a1b2c3d4e5f6...'
```

## Base32 Encoding

> **Server-only:** These functions are only available in server-side procedures (scripts, APIs, scheduled jobs).

### base32.encode

Encodes bytes to a Base32 string.

**Returns:** `string`

```sql
select base32.encode(string.to_utf8('Hello'));
-- 'JBSWY3DP'
```

### base32.decode

Decodes a Base32 string to bytes.

**Returns:** `bytes`

```sql
select base32.decode('JBSWY3DP');
-- <bytes>
select string.from_utf8(base32.decode('JBSWY3DP'));
-- 'Hello'
```
