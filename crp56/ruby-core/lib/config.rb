# frozen_string_literal: true

module CRP56
  ##
  # Runtime configuration for the CRP56 crypto engine.
  #
  # This object holds the tunable settings that control payload sizing, KDF
  # behavior, HMAC usage, and compression behavior. It is validated before
  # encryption or decryption so the rest of the backend can rely on the values.
  #
  # Default compression is Zstd.
  class Config
    attr_accessor :shard_plain_size, :salt_size, :kdf_iterations, :use_hmac, :use_compression, :compression_mode

    ##
    # Creates a config object with the current backend defaults.
    #
    # Defaults:
    # - shard size: 64 KiB
    # - salt size: 16 bytes
    # - KDF iterations: 200,000
    # - HMAC enabled
    # - compression enabled
    # - compression mode: Zstd
    def initialize
      @shard_plain_size = Constants::DEFAULT_SHARD_PLAIN_SIZE
      @salt_size = Constants::DEFAULT_SALT_SIZE
      @kdf_iterations = Constants::PBKDF2_ITERATIONS
      @use_hmac = true
      @use_compression = true
      @compression_mode = Constants::COMPRESSION_ZSTD
    end

    ##
    # Validates the configuration values.
    #
    # @raise [ConfigError] when any setting is invalid
    # @return [Boolean] true when the config is valid
    def validate!
      unless shard_plain_size.is_a?(Integer) && shard_plain_size.positive?
        raise ConfigError, "ShardPlainSize must be a positive integer."
      end

      unless salt_size.is_a?(Integer) && salt_size.positive?
        raise ConfigError, "SaltSize must be a positive integer."
      end

      unless kdf_iterations.is_a?(Integer) && kdf_iterations.positive?
        raise ConfigError, "KdfIterations must be a positive integer."
      end

      unless [true, false].include?(use_hmac)
        raise ConfigError, "UseHmac must be true or false."
      end

      unless [true, false].include?(use_compression)
        raise ConfigError, "UseCompression must be true or false."
      end

      valid_modes = [
        Constants::COMPRESSION_NONE,
        Constants::COMPRESSION_ZSTD,
        Constants::COMPRESSION_LZ4
      ]

      unless valid_modes.include?(compression_mode)
        raise ConfigError, "CompressionMode is invalid."
      end

      @compression_mode = Constants::COMPRESSION_NONE unless use_compression
      true
    end
  end
end