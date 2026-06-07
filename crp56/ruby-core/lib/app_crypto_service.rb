# frozen_string_literal: true

module CRP56
  class AppCryptoService
    DEFAULT_PHRASE_STORE_PATH = File.expand_path("../secrets/phrase_store.json", __dir__)

    def initialize(phrase_store_path: DEFAULT_PHRASE_STORE_PATH)
      @phrase_store_path = phrase_store_path
      @phrase_store = nil
      @config = nil
      @cipher = nil
      @file_crypto = nil
    end

    def has_secrets?
      return false unless File.exist?(@phrase_store_path)
      return false unless File.file?(@phrase_store_path)

      begin
        PhraseStore.load(@phrase_store_path).valid?
      rescue PhraseStoreError
        false
      rescue StandardError
        false
      end
    end

    def get_required_phrase_store
      @phrase_store ||= begin
                          store = PhraseStore.load(@phrase_store_path)

                          unless store.valid?
                            raise PhraseStoreError,
                                  "CRP56 phrase store is missing or invalid. Configure all six phrases first."
                          end

                          store
                        end
    rescue PhraseStoreError
      raise
    rescue StandardError => e
      raise PhraseStoreError, "Failed to load phrase store: #{e.message}"
    end

    def encrypt_text_to_base64(plain_text, user_passphrase)
      file_crypto.encrypt_text_to_base64(plain_text, user_passphrase)
    end

    def decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)
      file_crypto.decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)
    end

    def encrypt_bytes(plain_bytes, user_passphrase)
      file_crypto.encrypt_bytes(plain_bytes, user_passphrase)
    end

    def decrypt_bytes(cipher_bytes, user_passphrase)
      file_crypto.decrypt_bytes(cipher_bytes, user_passphrase)
    end

    def encrypt_file_bytes(source_file_path, user_passphrase)
      file_crypto.encrypt_file_bytes(source_file_path, user_passphrase)
    end

    def decrypt_file_bytes(encrypted_file_path, user_passphrase)
      file_crypto.decrypt_file_bytes(encrypted_file_path, user_passphrase)
    end

    def encrypt_file_to_path(source_file_path, output_file_path, user_passphrase)
      file_crypto.encrypt_file_to_path(source_file_path, output_file_path, user_passphrase)
    end

    def decrypt_file_to_path(encrypted_file_path, output_file_path, user_passphrase)
      file_crypto.decrypt_file_to_path(encrypted_file_path, output_file_path, user_passphrase)
    end

    def create_cipher
      @cipher ||= Crypto.new(
        config: build_default_config,
        phrase_store: get_required_phrase_store
      )
    end

    def file_crypto
      @file_crypto ||= FileCrypto.new(cipher: create_cipher)
    end

    private

    def build_default_config
      @config ||= begin
                    config = Config.new
                    config.shard_plain_size = Constants::DEFAULT_SHARD_PLAIN_SIZE
                    config.salt_size = Constants::DEFAULT_SALT_SIZE
                    config.kdf_iterations = Constants::PBKDF2_ITERATIONS
                    config.use_hmac = true
                    config.use_compression = true
                    config.compression_mode = Constants::COMPRESSION_ZSTD
                    config.validate!
                    config
                  end
    end
  end
end