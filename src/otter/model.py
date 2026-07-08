import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional

# Standard constants from training
POLICY_DIM = 4208
ELO_BUCKETS = 11
AUX_DIM = 141
TIME_CONTROL_BUCKETS = 5

class ResidualBlock(nn.Module):
    def __init__(self, channels: int, dropout: float = 0.1):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)
        self.dropout = nn.Dropout2d(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = F.relu(self.bn1(self.conv1(x)), inplace=True)
        x = self.dropout(x)
        x = self.bn2(self.conv2(x))
        return F.relu(x + residual, inplace=True)

class BoardEncoder(nn.Module):
    def __init__(self, output_dim: int = 256, num_blocks: int = 4, dropout: float = 0.1):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(18, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout),
            nn.Conv2d(64, 128, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout),
            nn.Conv2d(128, output_dim, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(output_dim),
            nn.ReLU(inplace=True),
        )
        self.blocks = nn.Sequential(*[ResidualBlock(output_dim, dropout) for _ in range(num_blocks)])

    def forward(self, board: torch.Tensor) -> torch.Tensor:
        return self.blocks(self.stem(board))

class HistoryEncoder(nn.Module):
    def __init__(self, vocab_size: int = 4209, embed_dim: int = 128, output_dim: int = 256, max_seq_len: int = 20):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.position_embedding = nn.Parameter(torch.randn(1, max_seq_len, embed_dim) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(d_model=embed_dim, nhead=4, dim_feedforward=256, dropout=0.1, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=2)
        self.token_proj = nn.Linear(embed_dim, output_dim)
        self.pool_proj = nn.Linear(embed_dim, output_dim)

    def forward(self, history_ids: torch.Tensor, history_mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.embedding(history_ids)
        x = x + self.position_embedding[:, : x.size(1)]
        safe_mask = history_mask.clone()
        empty_rows = ~safe_mask.any(dim=1)
        safe_mask[:, -1] = safe_mask[:, -1] | empty_rows
        x = self.transformer(x, src_key_padding_mask=~safe_mask)
        masked = x * history_mask.unsqueeze(-1)
        pooled = masked.sum(dim=1) / history_mask.sum(dim=1, keepdim=True).clamp_min(1)
        return self.token_proj(x), self.pool_proj(pooled)

class FeedForward(nn.Module):
    def __init__(self, dim: int, hidden_dim: int):
        super().__init__()
        self.net = nn.Sequential(nn.LayerNorm(dim), nn.Linear(dim, hidden_dim), nn.GELU(), nn.Dropout(0.1), nn.Linear(hidden_dim, dim), nn.Dropout(0.1))
    def forward(self, x: torch.Tensor) -> torch.Tensor: return self.net(x)

class ConditionedAttention(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int, heads: int = 8, dim_head: int = 32):
        super().__init__()
        self.heads, self.dim_head = heads, dim_head
        inner_dim, self.scale = heads * dim_head, dim_head ** -0.5
        self.x_norm, self.context_norm = nn.LayerNorm(dim), nn.LayerNorm(context_dim)
        self.to_q, self.to_k, self.to_v = nn.Linear(dim, inner_dim, bias=False), nn.Linear(context_dim, inner_dim, bias=False), nn.Linear(context_dim, inner_dim, bias=False)
        self.cond_to_q = nn.Linear(cond_dim, inner_dim, bias=False)
        self.to_out = nn.Sequential(nn.Linear(inner_dim, dim), nn.Dropout(0.1))

    def forward(self, x: torch.Tensor, cond: torch.Tensor, context: Optional[torch.Tensor] = None, context_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        context = x if context is None else context
        x_norm, context_norm = self.x_norm(x), self.context_norm(context)
        b, n, _ = x_norm.shape
        c_n = context_norm.size(1)
        q = self.to_q(x_norm).view(b, n, self.heads, self.dim_head).transpose(1, 2)
        k = self.to_k(context_norm).view(b, c_n, self.heads, self.dim_head).transpose(1, 2)
        v = self.to_v(context_norm).view(b, c_n, self.heads, self.dim_head).transpose(1, 2)
        q = q + self.cond_to_q(cond).view(b, self.heads, 1, self.dim_head)
        scores = torch.matmul(q, k.transpose(-1, -2)) * self.scale
        if context_mask is not None: scores = scores.masked_fill(~context_mask[:, None, None, :], -1e9)
        out = torch.matmul(torch.softmax(scores, dim=-1), v).transpose(1, 2).contiguous().view(b, n, -1)
        return self.to_out(out)

class SelfAttentionBlock(nn.Module):
    def __init__(self, dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=dim, cond_dim=cond_dim)
        self.ff = FeedForward(dim, hidden_dim=1024)
    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond); return x + self.ff(x)

class CrossAttentionBlock(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=context_dim, cond_dim=cond_dim)
        self.ff = FeedForward(dim, hidden_dim=512)
    def forward(self, x: torch.Tensor, context: torch.Tensor, cond: torch.Tensor, context_mask: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond, context=context, context_mask=context_mask); return x + self.ff(x)

class StrongPolicyModel(nn.Module):
    def __init__(self, history_k: int = 20):
        super().__init__()
        self.board_encoder = BoardEncoder(output_dim=256, num_blocks=4)
        self.history_encoder = HistoryEncoder(max_seq_len=history_k)
        self.active_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.opponent_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.time_control_embedding = nn.Embedding(TIME_CONTROL_BUCKETS, 64)
        self.clock_mlp = nn.Sequential(nn.Linear(2, 64), nn.ReLU(inplace=True), nn.Linear(64, 64), nn.ReLU(inplace=True))
        cond_dim = 640
        self.rank_embedding, self.file_embedding = nn.Embedding(8, 256), nn.Embedding(8, 256)
        self.register_buffer("board_ranks", torch.arange(8).unsqueeze(1).expand(8, 8).reshape(64))
        self.register_buffer("board_files", torch.arange(8).unsqueeze(0).expand(8, 8).reshape(64))
        self.cross_block = CrossAttentionBlock(dim=256, context_dim=256, cond_dim=cond_dim)
        self.self_blocks = nn.ModuleList([SelfAttentionBlock(dim=256, cond_dim=cond_dim) for _ in range(4)])
        self.policy_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 1024), nn.ReLU(inplace=True), nn.Dropout(0.1), nn.Linear(1024, POLICY_DIM))
        self.aux_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 512), nn.ReLU(inplace=True), nn.Dropout(0.1), nn.Linear(512, AUX_DIM))
        self.value_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 64), nn.ReLU(inplace=True), nn.Linear(64, 1), nn.Tanh())

    def forward(self, board, history_ids, history_mask, active_elo, opponent_elo, tc, clock):
        board_tokens = self.board_encoder(board).flatten(2).transpose(1, 2)
        board_tokens = board_tokens + (self.rank_embedding(self.board_ranks) + self.file_embedding(self.board_files)).unsqueeze(0)
        history_tokens, history_pooled = self.history_encoder(history_ids, history_mask)
        cond = torch.cat([self.active_elo_embedding(active_elo), self.opponent_elo_embedding(opponent_elo), self.time_control_embedding(tc), self.clock_mlp(clock), history_pooled], dim=-1)
        x = self.cross_block(board_tokens, history_tokens, cond, history_mask)
        for block in self.self_blocks: x = block(x, cond)
        pooled = x.mean(dim=1)
        return self.policy_proj(pooled), self.aux_proj(pooled), self.value_proj(pooled).squeeze(-1)
