# frozen_string_literal: true

require "json"
require "securerandom"
require "fileutils"

module CRP56
  class PhraseStore
    attr_reader :phrases, :source_path

    def initialize(phrases = nil, source_path: nil)
      @phrases = normalize_phrases(phrases || default_phrase_hash)
      @source_path = source_path
    end

    # ─── Class methods ──────────────────────────────────────────────────────────

    def self.load(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if blank_path?(path)
      raise PhraseStoreError, "Phrase store file not found: #{path}" unless File.exist?(path)

      raw = File.read(path, encoding: "UTF-8")
      data = JSON.parse(raw)

      new(data, source_path: path)
    rescue JSON::ParserError => e
      raise PhraseStoreError, "Failed to parse phrase store JSON: #{e.message}"
    end

    def self.valid_path?(path)
      return false if blank_path?(path)
      return false unless File.exist?(path) && File.file?(path)

      begin
        load(path).valid?
      rescue PhraseStoreError, StandardError
        false
      end
    end

    # ─── Instance methods ────────────────────────────────────────────────────────

    def save(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if self.class.send(:blank_path?, path)

      dir = File.dirname(path)
      FileUtils.mkdir_p(dir) unless Dir.exist?(dir)

      File.write(path, JSON.pretty_generate(@phrases), encoding: "UTF-8")
      @source_path = path
    end

    def valid?
      return false unless phrases.is_a?(Hash)
      return false unless phrases.keys.sort == expected_keys.sort

      expected_keys.all? do |key|
        value = phrases[key]
        value.is_a?(String) && !value.strip.empty?
      end
    end

    def validate!
      return true if valid?

      raise PhraseStoreError,
            "Phrase store is invalid. Exactly #{Constants::KEY_PHRASE_SLOTS} non-empty phrases are required."
    end

    def get_phrase(slot_index)
      validate_slot_index!(slot_index)

      value = phrases[slot_key(slot_index)]
      if value.nil? || value.strip.empty?
        raise PhraseStoreError, "Phrase slot #{slot_index} is empty or missing."
      end

      value
    end

    def set_phrase(slot_index, phrase)
      validate_slot_index!(slot_index)

      if phrase.nil? || phrase.strip.empty?
        raise PhraseStoreError, "Phrase cannot be nil or empty."
      end

      phrases[slot_key(slot_index)] = phrase
    end

    def random_slot_picker
      SecureRandom.random_number(Constants::KEY_PHRASE_SLOTS)
    end

    def to_a
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| get_phrase(index) }
    end

    def to_h
      @phrases.dup
    end

    def source
      @source_path ? :file : :unknown
    end

    # ─── Private ─────────────────────────────────────────────────────────────────

    private

    def normalize_phrases(input)
      normalized = default_phrase_hash

      input.each do |key, value|
        normalized_key = normalize_key(key)
        normalized[normalized_key] = value if normalized.key?(normalized_key)
      end

      normalized
    end

    def default_phrase_hash
      (0...Constants::KEY_PHRASE_SLOTS).each_with_object({}) do |index, hash|
        hash[slot_key(index)] = ""
      end
    end

    def expected_keys
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| slot_key(index) }
    end

    def slot_key(index)
      "slot_#{index}"
    end

    def normalize_key(key)
      string_key = key.to_s.strip

      # Already a valid slot key for any slot count
      return string_key if string_key.match?(/\Aslot_\d+\z/)

      # Plain integer string — convert to slot key
      return slot_key(string_key.to_i) if string_key.match?(/\A\d+\z/)

      string_key
    end

    def validate_slot_index!(slot_index)
      unless slot_index.is_a?(Integer) && slot_index >= 0 && slot_index < Constants::KEY_PHRASE_SLOTS
        raise PhraseStoreError, "Invalid slot index #{slot_index.inspect}. " \
                "Must be between 0 and #{Constants::KEY_PHRASE_SLOTS - 1}."
      end
    end

    def self.blank_path?(path)
      path.nil? || path.to_s.strip.empty?
    end

    private_class_method :blank_path?
  end
end