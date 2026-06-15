# frozen_string_literal: true

module CRP56
  ##
  # Base error class for all CRP56-specific failures.
  #
  # Library users can rescue +CRP56::Error+ to catch every error raised by the
  # backend, or rescue the more specific subclasses below when they need
  # finer-grained handling.
  class Error < StandardError; end

  ##
  # Raised when a configuration object contains invalid or unsupported values.
  class ConfigError < Error; end

  ##
  # Raised when the phrase store is missing, invalid, or cannot be loaded.
  class PhraseStoreError < Error; end

  ##
  # Raised when a payload cannot be parsed or does not match the expected
  # binary format.
  class InvalidPayloadError < Error; end

  ##
  # Raised when integrity verification fails, such as an HMAC mismatch.
  class IntegrityError < Error; end

  ##
  # Raised when decryption fails, including wrong passphrases or corrupted
  # ciphertext.
  class DecryptionError < Error; end
end