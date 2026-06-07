# frozen_string_literal: true

require "base64"
require "fileutils"

module CRP56
  class FileCrypto
    attr_reader :cipher

    def initialize(cipher:)
      raise ArgumentError, "cipher cannot be nil." if cipher.nil?

      @cipher = cipher
    end

    def encrypt_text_to_base64(plain_text, user_passphrase)
      raise ArgumentError, "Plain text cannot be nil or empty." if blank?(plain_text)

      plain_bytes = plain_text.encode("UTF-8").b
      encrypted_bytes = encrypt_bytes(plain_bytes, user_passphrase)

      Base64.strict_encode64(encrypted_bytes)
    end

    def decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)
      raise ArgumentError, "Cipher text cannot be nil or empty." if blank?(cipher_text_base64)

      begin
        cipher_bytes = Base64.strict_decode64(cipher_text_base64.strip)
      rescue ArgumentError
        raise InvalidPayloadError, "Cipher text is not valid Base64."
      end

      plain_bytes = decrypt_bytes(cipher_bytes, user_passphrase)

      plain_bytes.force_encoding("UTF-8")
      unless plain_bytes.valid_encoding?
        raise DecryptionError, "Decrypted text is not valid UTF-8."
      end

      plain_bytes
    end

    def encrypt_bytes(plain_bytes, user_passphrase)
      raise ArgumentError, "Plain bytes cannot be nil or empty." if plain_bytes.nil? || plain_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      cipher.encrypt(plain_bytes, user_passphrase)
    end

    def decrypt_bytes(cipher_bytes, user_passphrase)
      raise ArgumentError, "Cipher bytes cannot be nil or empty." if cipher_bytes.nil? || cipher_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      cipher.decrypt(cipher_bytes, user_passphrase)
    end

    def encrypt_file_bytes(source_file_path, user_passphrase)
      validate_source_file!(source_file_path)

      plain_bytes = File.binread(source_file_path)
      encrypt_bytes(plain_bytes, user_passphrase)
    end

    def decrypt_file_bytes(encrypted_file_path, user_passphrase)
      validate_source_file!(encrypted_file_path)

      cipher_bytes = File.binread(encrypted_file_path)
      decrypt_bytes(cipher_bytes, user_passphrase)
    end

    def encrypt_file_to_path(source_file_path, output_file_path, user_passphrase)
      validate_output_path!(output_file_path)

      encrypted_bytes = encrypt_file_bytes(source_file_path, user_passphrase)
      ensure_output_directory!(output_file_path)
      File.binwrite(output_file_path, encrypted_bytes)

      output_file_path
    end

    def decrypt_file_to_path(encrypted_file_path, output_file_path, user_passphrase)
      validate_output_path!(output_file_path)

      plain_bytes = decrypt_file_bytes(encrypted_file_path, user_passphrase)
      ensure_output_directory!(output_file_path)
      File.binwrite(output_file_path, plain_bytes)

      output_file_path
    end

    private

    def validate_source_file!(path)
      raise ArgumentError, "Source file path cannot be nil or empty." if blank?(path)
      raise ArgumentError, "Source file was not found: #{path}" unless File.exist?(path)
      raise ArgumentError, "Source path is not a file: #{path}" unless File.file?(path)
    end

    def validate_output_path!(path)
      raise ArgumentError, "Output file path cannot be nil or empty." if blank?(path)
    end

    def ensure_output_directory!(path)
      dir = File.dirname(path)
      return if dir.nil? || dir == "." || dir.empty?

      FileUtils.mkdir_p(dir)
    end

    def blank?(value)
      value.nil? || value.to_s.strip.empty?
    end
  end
end