# frozen_string_literal: true
require "openssl"

module CRP56
  module Kdf
    TOTAL_DERIVED_KEY_BYTES = Constants::AES_KEY_SIZE * 2

    DerivedKeys = Struct.new(:aes_key, :hmac_key, keyword_init: true)

    module_function

    def derive(base_phrase, user_passphrase, salt, iterations)
      raise ArgumentError, "Base phrase cannot be null or empty." if blank?(base_phrase)
      raise ArgumentError, "User passphrase cannot be null or empty." if blank?(user_passphrase)
      raise ArgumentError, "Salt cannot be null or empty." if salt.nil? || salt.empty?
      raise ArgumentError, "Iterations must be a positive integer." unless iterations.to_i.positive?

      combined = "#{base_phrase}|CRP56|#{user_passphrase}"
      derived_bytes = OpenSSL::KDF.pbkdf2_hmac(combined, salt: salt, iterations: iterations, length: TOTAL_DERIVED_KEY_BYTES, hash: "sha256")

      aes_key = derived_bytes.byteslice(0, Constants::AES_KEY_SIZE)
      hmac_key = derived_bytes.byteslice(Constants::AES_KEY_SIZE, Constants::AES_KEY_SIZE)

      DerivedKeys.new(aes_key: aes_key, hmac_key: hmac_key)
    end

    def salt_generation(size_of_bytes)
      raise ArgumentError, "Salt size must be a positive integer." unless size_of_bytes.to_i.positive?

      OpenSSL::Random.random_bytes(size_of_bytes)
    end

    def blank?(value)
      value.nil? || value.strip.empty?
    end
    private_class_method :blank?
  end
end