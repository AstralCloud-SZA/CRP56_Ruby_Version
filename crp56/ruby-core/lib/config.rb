# frozen_string_literal: true

module CRP56
  class Config
    attr_accessor :shard_plain_size,
                  :salt_size,
                  :kdf_iterations,
                  :use_hmac,
                  :use_compression,
                  :compression_mode

    def initialize
      @shard_plain_size = Constants::DEFAULT_SHARD_PLAIN_SIZE
      @salt_size = Constants::DEFAULT_SALT_SIZE
      @kdf_iterations = Constants::PBKDF2_ITERATIONS
      @use_hmac = true
      @use_compression = true
      @compression_mode = Constants::COMPRESSION_ZSTD
    end

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

      unless use_hmac || !use_hmac
        raise ConfigError, "UseHmac must be true or false."
      end

      unless use_compression || !use_compression
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

      if !use_compression && compression_mode != Constants::COMPRESSION_NONE
        @compression_mode = Constants::COMPRESSION_NONE
      end

      true
    end
  end
end