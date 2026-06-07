# frozen_string_literal: true

# frozen_string_literal: true

require "json"

require_relative "lib/constants"
require_relative "lib/errors"
require_relative "lib/kdf"

begin
  require_relative "lib/header"
rescue LoadError
end

begin
  require_relative "lib/compression"
rescue LoadError
end

begin
  require_relative "lib/phrase_store"
rescue LoadError
end

begin
  require_relative "lib/crypto"
rescue LoadError
end

begin
  require_relative "lib/file_crypto"
rescue LoadError
end

begin
  require_relative "lib/app_crypto_service"
rescue LoadError
end

module CRP56
  class Cli
    def self.run(argv)
      command = argv.shift

      case command
      when nil, "help", "--help", "-h"
        print_help
        0

      when "version"
        puts "CRP56 Ruby backend ready"
        puts "Format version: #{CRP56::Constants::VERSION}"
        0

      when "kdf_test"
        run_kdf_test(argv)
        0

      else
        warn "Unknown command: #{command}"
        print_help
        1
      end
    rescue StandardError => e
      warn "[CRP56 ERROR] #{e.class}: #{e.message}"
      1
    end

    def self.print_help
      puts "CRP56 Ruby Backend"
      puts
      puts "Commands:"
      puts "  ruby main.rb help"
      puts "  ruby main.rb version"
      puts "  ruby main.rb kdf_test BASE_PHRASE USER_PASSPHRASE"
      puts
      puts "Current status:"
      puts "  - Base project bootstrapped"
      puts "  - constants.rb loaded"
      puts "  - errors.rb loaded"
      puts "  - kdf.rb loaded"
      puts "  - header/crypto/file support will be added next"
    end

    def self.run_kdf_test(argv)
      base_phrase = argv.shift
      user_passphrase = argv.shift

      if blank?(base_phrase) || blank?(user_passphrase)
        raise ArgumentError, "Usage: ruby main.rb kdf_test BASE_PHRASE USER_PASSPHRASE"
      end

      salt = CRP56::Kdf.salt_generation(CRP56::Constants::DEFAULT_SALT_SIZE)
      derived = CRP56::Kdf.derive(
        base_phrase,
        user_passphrase,
        salt,
        CRP56::Constants::PBKDF2_ITERATIONS
      )

      result = {
        ok: true,
        command: "kdf_test",
        salt_base64: [salt].pack("m0"),
        aes_key_length: derived.aes_key.bytesize,
        hmac_key_length: derived.hmac_key.bytesize
      }

      puts JSON.generate(result)
    end

    def self.blank?(value)
      value.nil? || value.strip.empty?
    end

    private_class_method :blank?
  end
end

exit(CRP56::Cli.run(ARGV))