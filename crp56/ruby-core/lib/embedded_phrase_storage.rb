# frozen_string_literal: true

require "securerandom"

module CRP56
  # Replace these with your real six base phrases.
  # You can leave them as plain strings or lightly obfuscate (e.g. Base64).
  EMBEDDED_PHRASES = [
    "Killer Lord Primordial White",
    "Testarossa Lord Of The underWorld",
    "All Of Creation Seimei Shihai",
    "Jajjimento Genkai Toppa",
    "Jigen Hadan Abisu Anaiareshon",
    "Gurabiti Korapusu Nyukuria Fureimu"
  ].freeze

  class EmbeddedPhraseStore
    SLOT_COUNT = 6

    def initialize(phrases = EMBEDDED_PHRASES)
      @phrases = phrases.freeze
    end

    def get_phrase(index)
      validate_index!(index)
      phrase = @phrases[index]
      if phrase.nil? || phrase.strip.empty?
        raise PhraseStoreError, "Embedded phrase at slot #{index} is missing or empty."
      end
      phrase
    end

    def random_slot_picker
      rand(0...SLOT_COUNT)
    end

    def valid?
      return false unless @phrases.is_a?(Array)
      return false unless @phrases.size == SLOT_COUNT

      @phrases.all? { |p| p.is_a?(String) && !p.strip.empty? }
    end

    def validate!
      raise PhraseStoreError, "Embedded phrase store is invalid." unless valid?
      true
    end

    private

    def validate_index!(index)
      unless index.is_a?(Integer) && index >= 0 && index < SLOT_COUNT
        raise PhraseStoreError, "Phrase index out of range: #{index.inspect}"
      end
    end
  end
end