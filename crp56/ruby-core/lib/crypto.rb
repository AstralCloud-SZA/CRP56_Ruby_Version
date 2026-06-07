# frozen_string_literal: true

require "openssl"
require "stringio"

module CRP56
  class Crypto
    attr_reader :config, :phrase_store

    def initialize(config:, phrase_store:)
      raise ArgumentError, "config cannot be nil." if config.nil?
      raise ArgumentError, "phrase_store cannot be nil." if phrase_store.nil?

      @config = config
      @phrase_store = phrase_store

      @config.validate!
      @phrase_store.validate!
    end

    def encrypt(plain_data, user_passphrase)
      raise ArgumentError, "Plaintext cannot be nil or empty." if plain_data.nil? || plain_data.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      key_slot_index = phrase_store.random_slot_picker
      salt = Kdf.salt_generation(config.salt_size)

      base_phrase = phrase_store.get_phrase(key_slot_index)
      derived_keys = Kdf.derive(base_phrase, user_passphrase, salt, config.kdf_iterations)

      compression_mode = config.use_compression ? config.compression_mode : Constants::COMPRESSION_NONE
      data_to_encrypt = compression_mode == Constants::COMPRESSION_NONE ? plain_data : Compression.compress(plain_data, compression_mode)

      total_shards, last_shard_plain_size = compute_shard_layout(data_to_encrypt.bytesize, config.shard_plain_size)

      header = Header.new
      header.version = Constants::VERSION
      header.key_slot_index = key_slot_index
      header.flags = 0
      header.salt = salt
      header.kdf_iterations = config.kdf_iterations
      header.compression_mode = compression_mode
      header.total_shards = total_shards
      header.last_shard_size = last_shard_plain_size
      header.hmac_enabled = config.use_hmac

      encrypt_internal(data_to_encrypt, header, derived_keys)
    end

    def decrypt(cipher_data, user_passphrase)
      raise ArgumentError, "Input data cannot be nil or empty." if cipher_data.nil? || cipher_data.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      decrypt_internal(cipher_data, user_passphrase)
    end

    private

    def encrypt_internal(plain_data, header, derived_keys)
      buffer = StringIO.new("".b, "w+b")
      header.write_to(buffer)

      offset = 0
      shard_size = config.shard_plain_size

      header.total_shards.times do |shard_index|
        expected_plain_size = shard_index == header.total_shards - 1 ? header.last_shard_size : shard_size
        shard_plain = plain_data.byteslice(offset, expected_plain_size)
        offset += expected_plain_size

        iv = OpenSSL::Random.random_bytes(Constants::AES_BLOCK_SIZE)
        buffer.write(iv)

        cipher = OpenSSL::Cipher.new("AES-256-CBC")
        cipher.encrypt
        cipher.key = derived_keys.aes_key
        cipher.iv = iv

        shard_cipher = cipher.update(shard_plain) + cipher.final
        buffer.write(shard_cipher)
      end

      without_hmac = buffer.string
      return without_hmac unless header.hmac_enabled?

      hmac_tag = OpenSSL::HMAC.digest("SHA256", derived_keys.hmac_key, without_hmac)
      without_hmac + hmac_tag
    end

    def decrypt_internal(cipher_data, user_passphrase)
      header_io = StringIO.new(cipher_data, "rb")
      header = Header.read_from(header_io)

      cipher_without_hmac, hmac_tag =
        if header.hmac_enabled?
          if cipher_data.bytesize < Header::HMAC_TAG_LENGTH
            raise InvalidPayloadError, "Data too short to contain valid HMAC tag."
          end

          tag_offset = cipher_data.bytesize - Header::HMAC_TAG_LENGTH
          [cipher_data.byteslice(0, tag_offset), cipher_data.byteslice(tag_offset, Header::HMAC_TAG_LENGTH)]
        else
          [cipher_data, nil]
        end

      base_phrase = phrase_store.get_phrase(header.key_slot_index)
      derived_keys = Kdf.derive(base_phrase, user_passphrase, header.salt, header.kdf_iterations)

      if header.hmac_enabled?
        computed_tag = OpenSSL::HMAC.digest("SHA256", derived_keys.hmac_key, cipher_without_hmac)

        unless constant_time_equals?(computed_tag, hmac_tag)
          raise IntegrityError, "HMAC verification failed. Data may be corrupted or password is incorrect."
        end
      end

      reader = StringIO.new(cipher_without_hmac, "rb")
      Header.read_from(reader)

      plain_parts = []
      shard_size = config.shard_plain_size
      block_size = Constants::AES_BLOCK_SIZE

      header.total_shards.times do |shard_index|
        expected_plain_size = shard_index == header.total_shards - 1 ? header.last_shard_size : shard_size

        iv = reader.read(block_size)
        if iv.nil? || iv.bytesize != block_size
          raise InvalidPayloadError, "Unexpected end of data while reading IV for shard #{shard_index}."
        end

        padded_cipher_size = get_padded_cipher_size(expected_plain_size, block_size)

        shard_cipher = reader.read(padded_cipher_size)
        if shard_cipher.nil? || shard_cipher.bytesize != padded_cipher_size
          raise InvalidPayloadError, "Unexpected end of data while reading ciphertext for shard #{shard_index}."
        end

        cipher = OpenSSL::Cipher.new("AES-256-CBC")
        cipher.decrypt
        cipher.key = derived_keys.aes_key
        cipher.iv = iv

        shard_plain = cipher.update(shard_cipher) + cipher.final

        if shard_plain.bytesize != expected_plain_size
          raise DecryptionError, "Decrypted shard #{shard_index} has unexpected length. Data may be corrupted or password is incorrect."
        end

        plain_parts << shard_plain
      end

      reassembled = plain_parts.join
      return reassembled if header.compression_mode == Constants::COMPRESSION_NONE

      Compression.decompress(reassembled, header.compression_mode)
    rescue OpenSSL::Cipher::CipherError => e
      raise DecryptionError, "Decryption failed: #{e.message}"
    end

    def compute_shard_layout(total_plain_bytes, shard_plain_size)
      raise ArgumentError, "Plaintext length must be positive." unless total_plain_bytes.positive?
      raise ArgumentError, "Shard size must be positive." unless shard_plain_size.positive?

      total_shards = (total_plain_bytes + shard_plain_size - 1) / shard_plain_size
      last_shard_plain_size = total_plain_bytes % shard_plain_size
      last_shard_plain_size = shard_plain_size if last_shard_plain_size.zero?

      [total_shards, last_shard_plain_size]
    end

    def get_padded_cipher_size(plain_size, block_size)
      raise ArgumentError, "Block size must be positive." unless block_size.positive?

      ((plain_size + block_size) / block_size) * block_size
    end

    def constant_time_equals?(a, b)
      return false if a.nil? || b.nil? || a.bytesize != b.bytesize

      diff = 0
      a.bytes.zip(b.bytes) { |x, y| diff |= (x ^ y) }
      diff.zero?
    end

    def blank?(value)
      value.nil? || value.strip.empty?
    end
  end
end