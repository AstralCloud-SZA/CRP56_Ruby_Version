# frozen_string_literal: true

require "zstd-ruby"

begin
  require "lz4-ruby"
rescue LoadError
  LZ4_AVAILABLE = false
else
  LZ4_AVAILABLE = true
end

module CRP56
  module Compression
    module_function

    def compress(data, compression_mode)
      raise ArgumentError, "Data cannot be nil." if data.nil?

      case compression_mode
      when Constants::COMPRESSION_NONE
        data
      when Constants::COMPRESSION_ZSTD
        Zstd.compress(data)
      when Constants::COMPRESSION_LZ4
        raise CompressionError, "LZ4 compression is not available in this Ruby environment." unless LZ4_AVAILABLE

        compress_lz4(data)
      else
        raise CompressionError, format("Unsupported compression mode: 0x%02X", compression_mode)
      end
    rescue CompressionError
      raise
    rescue StandardError => e
      raise CompressionError, "Compression failed: #{e.message}"
    end

    def decompress(data, compression_mode)
      raise ArgumentError, "Data cannot be nil." if data.nil?

      case compression_mode
      when Constants::COMPRESSION_NONE
        data
      when Constants::COMPRESSION_ZSTD
        Zstd.decompress(data)
      when Constants::COMPRESSION_LZ4
        raise CompressionError, "LZ4 compression is not available in this Ruby environment." unless LZ4_AVAILABLE

        decompress_lz4(data)
      else
        raise CompressionError, format("Unsupported compression mode: 0x%02X", compression_mode)
      end
    rescue CompressionError
      raise
    rescue StandardError => e
      raise CompressionError, "Decompression failed: #{e.message}"
    end

    def lz4_available?
      LZ4_AVAILABLE
    end

    def compress_lz4(data)
      if defined?(LZ4::Raw) && LZ4::Raw.respond_to?(:compress)
        LZ4::Raw.compress(data)
      elsif defined?(LZ4) && LZ4.respond_to?(:compress)
        LZ4.compress(data)
      else
        raise CompressionError, "LZ4 gem loaded, but no supported compress API was found."
      end
    end
    private_class_method :compress_lz4

    def decompress_lz4(data)
      if defined?(LZ4::Raw) && LZ4::Raw.respond_to?(:decompress)
        LZ4::Raw.decompress(data)
      elsif defined?(LZ4) && LZ4.respond_to?(:uncompress)
        LZ4.uncompress(data)
      elsif defined?(LZ4) && LZ4.respond_to?(:decompress)
        LZ4.decompress(data)
      else
        raise CompressionError, "LZ4 gem loaded, but no supported decompress API was found."
      end
    end
    private_class_method :decompress_lz4
  end
end